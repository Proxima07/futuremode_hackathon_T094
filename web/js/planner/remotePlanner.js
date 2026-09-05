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
 *   scan    每 250ms 本機取樣，不受網路請求阻塞
 *   plan    所有階段都以每秒一次為目標，READY 也持續檢查固定目標
 *   light   首次或本機確認光線明顯變化才分析
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
  resetSceneMemory, sampleFrame,
} from "../lib/api.js";
import { measure } from "../vision/exposure.js";
import { comparePreviewFrames } from "../vision/frameFreshness.js";

/** 移動判定的參數。缺值時退回內建預設，不要變成 undefined。 */
const MOTION = () => {
  const m = CONFIG.MOTION ?? {};
  return {
    threshold: Number.isFinite(m.threshold) ? m.threshold : 16,
    radius: Number.isFinite(m.radius) ? m.radius : 3,
    confirmations: Number.isFinite(m.confirmations) ? m.confirmations : 2,
  };
};
import { LightChangeMonitor } from "../vision/lightChangeMonitor.js";

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
const SCAN_MS = () => Math.max(100, cfg("SCAN_INTERVAL_MS", 250));
const LIGHT_CHECK_MS = () => cfg("LIGHT_CHECK_INTERVAL_MS", 1000);
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
    this.revision = 0;
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
    this.lastPlanResponseAt = null;
    this.lastAppliedFrameAt = null;
    this.lastResponseMeta = null;
    this.lastFrameDifference = null;
    this.displayFrame = null;
    this.previousFrame = null;
    this.viewPending = false;
    this.deferReason = "";
    this.previewStable = true;
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

    this.lightMonitor = new LightChangeMonitor(CONFIG.LIGHT_CHANGE);
    this.lightRevision = 0;
    this.nextLightCheckAt = 0;
    this.lastLightSent = null;
    /** 最近一次的光線結果，除錯面板會顯示 */
    this.lastLight = null;

    this.failures = 0;
    this.failuresByKind = { plan: 0, light: 0, custom: 0 };
    this.lastLatency = 0;
    this.lastExposure = null;
    this.stats = { scan: 0, plan: 0, light: 0, custom: 0, skip: 0,
      responses: 0, applied: 0, fallback: 0 };

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
      `[planner] 取樣 ${SCAN_MS()}ms · plan 目標 ${PLAN_MS()}ms（含 READY） · 光線變化才分析 · ` +
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
    this.revision++;
    this.controller?.abort();
    this.setPlanPaused(false);
    this.nextPlanAt = 0;
    this.nextScanAt = 0;
    this.failuresByKind.plan = 0;
    this.lastPlanResultAt = null;
    this.lastPlanResponseAt = null;
    this.lastAppliedFrameAt = null;
    this.displayFrame = null;
    this.previousFrame = null;
    this.viewPending = false;
    this.deferReason = "";
    this.lastResponseMeta = null;
    this.planOutcome = "waiting";
    this._emitActivity();
  }

  /** 換鏡頭／拍攝情境才清除光線基準；單純重新對準不重做光線。 */
  resetLighting() {
    this.lightRevision++;
    this.lightMonitor.reset();
    this.nextLightCheckAt = 0;
    this.lastLight = null;
    this.lastExposure = null;
  }

  _deferPlan(reason = "moving") {
    this.viewPending = true;
    this.deferReason = reason;
    this.planOutcome = reason;
    this.on.onPlanDeferred?.({reason});
  }

  _observePreview(frame, now) {
    const motion = MOTION();
    this.previewStable = !this.previousFrame
      || comparePreviewFrames(this.previousFrame, frame, motion).fresh;
    this.previousFrame = frame;

    /**
     * ────────────────────────────────────────────────
     * 連續確認才算移動。
     *
     * 原本單幀比對就直接 _deferPlan("moving")，
     * 使用者手滑一下、或自動曝光跳一下，
     * 引導提示就被清掉、可拍攝狀態就被撤銷。
     *
     * 真正的移動會持續好幾幀，手震不會。
     * 取樣間隔 250ms，連續兩次約 0.5 秒，
     * 對「使用者真的把鏡頭移開了」來說反應仍然夠快。
     * ────────────────────────────────────────────────
     */
    const moved = this.displayFrame
      && !comparePreviewFrames(this.displayFrame, frame, motion).fresh;

    this.movingStreak = moved ? (this.movingStreak ?? 0) + 1 : 0;

    if (moved) {
      if (this.movingStreak >= motion.confirmations) this._deferPlan("moving");
    } else if (this.lastAppliedFrameAt !== null
        && now - this.lastAppliedFrameAt > cfg("PLAN_MAX_FRAME_AGE_MS", 5000)) {
      this._deferPlan("expired");
    }
    if (now >= this.nextLightCheckAt) {
      this.nextLightCheckAt = now + LIGHT_CHECK_MS();
      const ctx = this.getContext?.() ?? {};
      this.lastExposure = measure(this.video, ctx.subjectBox ?? null);
      this.lightMonitor.observe(this.lastExposure, {stable: this.previewStable});
      this.on.onExposure?.(this.lastExposure, {stable: this.previewStable});
    }
  }

  _checkReadyView(frame = sampleFrame(this.video)) {
    if (!this.planPaused || performance.now() - this.readyAt < 500) return;
    if (!frame) return;
    const motion = MOTION();
    this.changedFrames = !comparePreviewFrames(this.readyFrame, frame, motion).fresh
      ? this.changedFrames + 1 : 0;
    if (this.changedFrames >= motion.confirmations) this.on.onViewChanged?.();
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
      lastPlanResponseAt: this.lastPlanResponseAt, lastAppliedFrameAt: this.lastAppliedFrameAt,
      responseMeta: this.lastResponseMeta, viewPending: this.viewPending,
      deferReason: this.deferReason, responses: this.stats.responses,
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
            this._observePreview(frame, now);
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
    const urgentConfirmation = !!this.getContext?.()?.confirming;
    const lightPending = this.lightMonitor.shouldAnalyze(now) && this.previewStable &&
      !this.viewPending && !urgentConfirmation && this.lastPlanResultAt !== null;
    // 只有確實存在光線事件時才爭取排程，不再有每 6／30 秒的強制定時分析。
    const lightTurn = lightPending && this.plansSinceLight >= cfg("LIGHT_PLAN_BUDGET", 8);
    if (now >= this.nextPlanAt && !lightTurn) {
      await this._runPlan();
    } else if (lightPending && (lightTurn || this.nextPlanAt - now > this.lastLightLatency + 100)) {
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
    const revision = this.revision;
    const startedAt = performance.now();
    this.lastPlanGap = this.lastPlanSent === null ? null : startedAt - this.lastPlanSent;
    this.lastPlanSent = startedAt;
    this.nextPlanAt = startedAt + this.interval;
    // 新請求開始時保留 moving/error，避免又顯示十秒前採用結果的倒數。
    if (this.planOutcome === "waiting") this.planOutcome = "analyzing";
    const plan = await this._send(
      (payload, signal) => requestPlan(payload, signal, (meta) => {
        if (runId !== this.runId || revision !== this.revision || signal.aborted) return;
        if (sessionId !== undefined && this.getContext?.()?.sessionId !== sessionId) return;
        this.lastPlanResponseAt = performance.now();
        this.lastResponseMeta = meta;
        this.stats.responses++;
        if (meta.fallback) this.stats.fallback++;
      }),
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
    if (runId !== this.runId || revision !== this.revision) return;
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
    const comparison = comparePreviewFrames(
      submittedFrame, sampleFrame(this.video), MOTION()
    );
    this.lastFrameDifference = comparison;
    const expired = performance.now() - startedAt > cfg("PLAN_MAX_FRAME_AGE_MS", 5000);
    if (!comparison.fresh || expired) {
      this.stats.skip++;
      this._deferPlan(expired ? "expired" : "moving");
      this._emitActivity();
      return;
    }

    // 主路徑只回報「需要動態版型」，實際生成走另一條路
    // 由前端共識控制器核准後才生成，不能讓單次 LLM 輸出繞過鎖定。
    this.viewPending = false;
    this.deferReason = "";
    this.needsCustom = this.on.onPlan?.(plan) === true;
    // onPlan 可能觸發重新分析，不能把上一輪完成時間放到新工作階段。
    if (revision === this.revision && (sessionId === undefined || this.getContext?.()?.sessionId === sessionId)) {
      this.lastPlanResultAt = performance.now();
      this.lastAppliedFrameAt = startedAt;
      this.displayFrame = submittedFrame;
      this.stats.applied++;
      this.plansSinceLight++;
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
      this.lightMonitor.fail(performance.now());
      return;
    }

    // 把主體框傳進去，這樣才算得出「主體 vs 背景」的亮度比。
    // 少了這一步，模型只會分析整個場景——
    // 場地裡有一盞強燈就會壓過使用者真正要拍的東西。
    const ctx = this.getContext?.() ?? {};
    const runId = this.runId;
    const revision = this.revision;
    const lightRevision = this.lightRevision;
    const exposure = measure(this.video, ctx.subjectBox ?? null);
    this.lastExposure = exposure;

    const light = await this._send(
      requestLight,
      { image: img, intent: ctx.intent ?? "product", exposure },
      "light"
    );

    if (runId !== this.runId || revision !== this.revision || lightRevision !== this.lightRevision) return;
    if (ctx.sessionId !== undefined && this.getContext?.()?.sessionId !== ctx.sessionId) return;
    this.lastLightSent = performance.now();
    this.plansSinceLight = 0;
    if (light) {
      this.lightMonitor.accept(exposure, performance.now());
      // 結論沒變就不要洗版，只有變化時才印
      const sig = `${light.verdict}|${light.source}|${light.fill_from}`;
      if (sig !== this._lightSig) {
        this._lightSig = sig;
        console.log("[light]", light.verdict, "來源:" + light.source,
                    "補光:" + light.fill_from, light.advice || "");
      }
      this.lastLight = light;
      this.on.onLight?.(light);
    } else {
      this.lightMonitor.fail(performance.now());
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
