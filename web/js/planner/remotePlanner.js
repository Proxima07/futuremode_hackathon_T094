/**
 * 慢層排程器。管理三條到 VLM 的路徑。
 *
 * ────────────────────────────────────────────────
 * 為什麼三條路徑要分開排程
 *
 * 輸出的 token 數直接決定延遲。原本一次要模型吐出
 * 版型 + 微調 + 動態座標 + 物品配置 + 光線五欄位 + 建議，
 * 非常慢，實測會從 300ms 惡化到逾時。
 *
 * 按「變化速度」拆開：
 *   scan    每秒本機取樣，不受網路請求阻塞
 *   plan    所有階段都以每秒一次為目標，READY 也持續檢查固定目標
 *   light   房間的光不會變 → 每 6 秒
 *   custom  很少需要      → 只在 plan 說需要時，且有冷卻時間
 *
 * 拆開不是為了平行呼叫。同時打同一個端點只會讓兩邊都變慢，
 * 所以這裡刻意讓三條路徑「互相禮讓」：
 * 有請求在飛的時候，其他路徑就等下一輪。
 * ────────────────────────────────────────────────
 */

import { CONFIG } from "../lib/config.js";
import {
  grabFrame, requestPlan, requestLight, requestCustom,
  resetSceneMemory, sampleFrame, frameDifference,
} from "../lib/api.js";
import { measure } from "../vision/exposure.js";

const VIEW_CHANGE_THRESHOLD = 12;
const TICK_MS = 50;

/**
 * 設定值的保底。
 *
 * 為什麼需要：config.js 如果被瀏覽器快取成舊版，
 * 新加的設定值會是 undefined，算式就變成 NaN，
 * 而 `now - NaN > undefined` 永遠是 false——
 * 整條路徑靜靜地不執行，不報錯，非常難查。
 *
 * v0.21 就是這樣讓光線分析一次都沒跑到。
 */
function cfg(key, fallback) {
  const v = CONFIG[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const PLAN_MS = () => Math.max(250, cfg("PLAN_INTERVAL_MS", 1000));
const SCAN_MS = () => Math.max(250, cfg("SCAN_INTERVAL_MS", 1000));
const LIGHT_MS = () => cfg("LIGHT_INTERVAL_MS", 6000);
const LIGHT_MAX_DEFER_MS = () => cfg("LIGHT_MAX_DEFER_MS", 30000);
const CUSTOM_MS = () => cfg("CUSTOM_COOLDOWN_MS", 15000);

export class RemotePlanner {
  /**
   * @param {HTMLVideoElement} video
   * @param {() => Object} getContext  取得目前的情境與版型
   * @param {{onPlan:Function, onLight:Function, onCustom:Function}} handlers
   */
  constructor(video, getContext, handlers) {
    this.video = video;
    this.getContext = getContext;
    this.on = handlers;

    this.running = false;
    this.runId = 0;
    this.timer = null;
    this.dispatching = false;
    this.nextScanAt = 0;
    this.nextPlanAt = 0;
    this.paused = false;
    /** 代表構圖已 READY；保留 v0.30 介面，但不再暫停構圖檢查。 */
    this.planPaused = false;
    /** 同時只讓一條路徑在飛，避免互相拖慢 */
    this.busy = false;
    this.controller = null;
    this.activeKind = null;

    this.lastPlanSent = null;
    this.lastScanAt = null;
    this.lastPlanResultAt = null;
    this.lastPlanLatency = 0;
    this.lastPlanGap = null;
    this.lastLightLatency = 400;
    this.planOutcome = "waiting";
    this.plansSinceLight = 0;
    this.lastCustomAt = -Infinity;
    this.needsCustom = false;
    this.readyFrame = null;
    this.changedFrames = 0;
    this.readyAt = 0;

    // 第一次光線分析要早一點跑，不然使用者要等 6 秒才看得到東西。
    // 設成「現在減去大部分的間隔」，第一輪就會輪到它。
    this.lastLightSent = performance.now() - LIGHT_MS() + 1200;
    /** 最近一次的光線結果，除錯面板會顯示 */
    this.lastLight = null;

    this.failures = 0;
    this.failuresByKind = { plan: 0, light: 0, custom: 0 };
    this.lastLatency = 0;
    this.lastExposure = null;
    this.stats = { scan: 0, plan: 0, light: 0, custom: 0, skip: 0 };

    document.addEventListener("visibilitychange", () => {
      this.paused = document.hidden;
      if (this.paused) {
        this.controller?.abort();
      } else {
        this.on.onViewChanged?.();
        this.nextScanAt = 0;
        this.nextPlanAt = 0;
      }
      this._emitActivity();
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextScanAt = 0;
    this.nextPlanAt = 0;
    console.log(
      `[planner] 取樣 ${SCAN_MS()}ms · plan 目標 ${PLAN_MS()}ms（含 READY） · light ${LIGHT_MS()}ms · ` +
      `custom 冷卻 ${CUSTOM_MS()}ms`
    );
    this._tick(++this.runId);
  }

  stop() {
    this.running = false;
    this.runId++;
    clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this._emitActivity();
  }

  /** 標示 READY／恢復引導；兩者仍以相同頻率檢查畫面。 */
  setPlanPaused(paused) {
    this.planPaused = !!paused;
    if (this.planPaused) {
      this.needsCustom = false;
      this.readyFrame = sampleFrame(this.video);
      this.readyAt = performance.now();
      this.changedFrames = 0;
    } else {
      this.needsCustom = false;
      resetSceneMemory();
      this.readyFrame = null;
      this.changedFrames = 0;
    }
  }

  /** 狀態切換時中止舊請求；sessionId 仍是忽略慢回應的最後防線。 */
  invalidate() {
    this.controller?.abort();
    this.setPlanPaused(false);
    this.nextPlanAt = 0;
    this.nextScanAt = 0;
    this.failuresByKind.plan = 0;
    this.lastPlanResultAt = null;
    this.planOutcome = "waiting";
    this._emitActivity();
  }

  _checkReadyView(frame = sampleFrame(this.video)) {
    if (!this.planPaused || performance.now() - this.readyAt < 500) return;
    if (!frame) return;
    this.changedFrames = frameDifference(frame, this.readyFrame) > VIEW_CHANGE_THRESHOLD
      ? this.changedFrames + 1 : 0;
    if (this.changedFrames >= 2) this.on.onViewChanged?.();
  }

  /** 失敗越多次間隔越長，不要一直撞掛掉的後端 */
  get interval() {
    return Math.min(
      8000,
      PLAN_MS() * Math.pow(2, Math.min(this.failuresByKind.plan, 3))
    );
  }

  get activity() {
    return {
      running: this.running, paused: this.paused, activeKind: this.activeKind,
      scans: this.stats.scan, lastScanAt: this.lastScanAt,
      lastPlanResultAt: this.lastPlanResultAt, lastPlanLatency: this.lastPlanLatency,
      lastPlanGap: this.lastPlanGap, outcome: this.planOutcome,
    };
  }

  _emitActivity() { this.on.onActivity?.(this.activity); }

  /** 固定時鐘只做取樣和排程，不等待模型；同時最多一個遠端請求。 */
  _tick(runId) {
    if (!this.running || runId !== this.runId) return;
    try {
      if (!this.paused) {
        const now = performance.now();
        if (now >= this.nextScanAt) {
          this.nextScanAt = now + SCAN_MS();
          const frame = sampleFrame(this.video);
          if (frame) {
            this.lastScanAt = now;
            this.stats.scan++;
            this._checkReadyView(frame);
          }
          this._emitActivity();
        }
        if (!this.dispatching && !this.busy) {
          this.dispatching = true;
          this._dispatch(now).catch((err) => {
            console.warn("[planner] 排程失敗", err);
          }).finally(() => { this.dispatching = false; });
        }
      }
    } catch (err) {
      console.warn("[planner] 無法取樣畫面", err);
    } finally {
      if (this.running && runId === this.runId) {
        this.timer = setTimeout(() => this._tick(runId), TICK_MS);
      }
    }
  }

  async _dispatch(now) {
    if (this.needsCustom && now - this.lastCustomAt >= CUSTOM_MS()) {
      await this._runCustom();
      return;
    }
    const lightAge = now - this.lastLightSent;
    const urgentConfirmation = !!this.getContext?.()?.confirming;
    // 平常只用空檔做光線分析；模型很慢時偶爾讓光線更新，避免永久飢餓。
    const lightOverdue = !this.planPaused && !urgentConfirmation &&
      this.plansSinceLight >= 3 && lightAge >= LIGHT_MAX_DEFER_MS();
    if (now >= this.nextPlanAt && !lightOverdue) {
      await this._runPlan();
    } else if (!this.planPaused && !urgentConfirmation && lightAge >= LIGHT_MS() &&
        (lightOverdue || this.nextPlanAt - now > this.lastLightLatency + 100)) {
      await this._runLight();
    }
  }

  // ── 主路徑 ──────────────────────────────────────

  async _runPlan() {
    if (this.busy) return;
    // 靜止畫面也要送：候選共識與「對準了」都需要後續影格確認。
    const img = grabFrame(this.video);
    if (!img) {
      this.nextPlanAt = performance.now() + SCAN_MS();
      return;
    }
    const submittedFrame = sampleFrame(this.video);

    const ctx = this.getContext?.() ?? {};
    const sessionId = ctx.sessionId;
    const runId = this.runId;
    const startedAt = performance.now();
    this.lastPlanGap = this.lastPlanSent === null ? null : startedAt - this.lastPlanSent;
    this.lastPlanSent = startedAt;
    this.nextPlanAt = startedAt + this.interval;
    this.planOutcome = "analyzing";
    const plan = await this._send(
      requestPlan,
      {
        image: img,
        layouts: ctx.layouts ?? [],
        intent: ctx.intent ?? "product",
        phase: ctx.phase ?? "searching",
        last_action: ctx.lastAction ?? "none",
        last_advice: ctx.lastAdvice ?? "",
        current: ctx.current ?? null,
      },
      "plan"
    );

    // 換情境、鏡頭或按下重新分析後，忽略舊工作階段回來的慢回應。
    if (runId !== this.runId) return;
    const latestSession = this.getContext?.()?.sessionId;
    if (sessionId !== undefined && latestSession !== sessionId) return;
    this.lastPlanLatency = performance.now() - startedAt;
    if (!plan) {
      this.planOutcome = "error";
      this.nextPlanAt = Math.max(this.nextPlanAt, startedAt + this.interval);
      this._emitActivity();
      return;
    }
    // 成功就恢復一秒目標，時間從開始推論算起，不再額外加 700ms。
    this.nextPlanAt = startedAt + PLAN_MS();
    this.plansSinceLight++;

    // 模型分析的是較早的照片；大幅移動後，舊 READY 和移動提示都不能套用。
    if (frameDifference(submittedFrame, sampleFrame(this.video)) > VIEW_CHANGE_THRESHOLD) {
      this.stats.skip++;
      this.planOutcome = "stale";
      this._emitActivity();
      return;
    }

    // 主路徑只回報「需要動態版型」，實際生成走另一條路
    // 由前端共識控制器核准後才生成，不能讓單次 LLM 輸出繞過鎖定。
    this.needsCustom = this.on.onPlan?.(plan) === true;
    // onPlan 可能觸發重新分析，不能把上一輪完成時間放到新工作階段。
    if (sessionId === undefined || this.getContext?.()?.sessionId === sessionId) {
      this.lastPlanResultAt = performance.now();
      this.planOutcome = "updated";
    }
    this._emitActivity();
  }

  // ── 光線 ────────────────────────────────────────

  async _runLight() {
    const img = grabFrame(this.video);
    if (!img) {
      // 抓不到影格也要更新時間戳，否則下一輪還是輪到光線，
      // 主路徑就永遠排不上了
      this.lastLightSent = performance.now();
      return;
    }

    // 把主體框傳進去，這樣才算得出「主體 vs 背景」的亮度比。
    // 少了這一步，模型只會分析整個場景——
    // 場地裡有一盞強燈就會壓過使用者真正要拍的東西。
    const ctx = this.getContext?.() ?? {};
    const runId = this.runId;
    const exposure = measure(this.video, ctx.subjectBox ?? null);
    this.lastExposure = exposure;

    const light = await this._send(
      requestLight,
      { image: img, intent: ctx.intent ?? "product", exposure },
      "light"
    );

    if (runId !== this.runId) return;
    if (ctx.sessionId !== undefined && this.getContext?.()?.sessionId !== ctx.sessionId) return;
    this.lastLightSent = performance.now();
    this.plansSinceLight = 0;
    if (light) {
      // 結論沒變就不要洗版，只有變化時才印
      const sig = `${light.verdict}|${light.source}|${light.fill_from}`;
      if (sig !== this._lightSig) {
        this._lightSig = sig;
        console.log("[light]", light.verdict, "來源:" + light.source,
                    "補光:" + light.fill_from, light.advice || "");
      }
      this.lastLight = light;
      this.on.onLight?.(light);
    }
  }

  // ── 動態版型 ────────────────────────────────────

  async _runCustom() {
    const img = grabFrame(this.video);
    if (!img) {
      this.lastCustomAt = performance.now();
      this.needsCustom = false;
      this.on.onCustom?.(null);
      return;
    }

    const ctx = this.getContext?.() ?? {};
    const sessionId = ctx.sessionId;
    const runId = this.runId;
    const res = await this._send(
      requestCustom,
      { image: img, intent: ctx.intent ?? "product", current: ctx.current },
      "custom"
    );

    if (runId !== this.runId) return;
    this.lastCustomAt = performance.now();
    this.needsCustom = false;      // 不管成功與否都清掉，避免卡住
    const latestSession = this.getContext?.()?.sessionId;
    if (sessionId === undefined || latestSession === sessionId) {
      this.on.onCustom?.(res);
    }
  }

  // ── 共用的送出流程 ──────────────────────────────

  async _send(fn, payload, kind) {
    if (this.busy) return null;
    this.busy = true;
    const controller = new AbortController();
    this.controller = controller;
    this.activeKind = kind;
    const runId = this.runId;
    this.stats[kind]++;

    const t0 = performance.now();
    this._emitActivity();
    let res = null;
    try {
      res = await fn(payload, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) console.warn(`[planner] ${kind} 失敗`, err);
    } finally {
      this.lastLatency = Math.round(performance.now() - t0);
      if (kind === "light") this.lastLightLatency = this.lastLatency;
      if (this.controller === controller) {
        this.busy = false;
        this.controller = null;
        this.activeKind = null;
      }
    }
    if (controller.signal.aborted || runId !== this.runId) return null;

    if (res) {
      this.failures = 0;
      this.failuresByKind[kind] = 0;
    } else {
      this.failures++;
      this.failuresByKind[kind]++;
      if (this.failures === 1) {
        console.warn(`VLM 無回應（${kind}），畫面維持現狀`);
      }
    }
    return res;
  }
}
