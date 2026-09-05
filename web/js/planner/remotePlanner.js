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
 *   plan    物品一直在動  → 每 700ms（有變化才送）
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
  grabFrame, requestPlan, requestLight, requestCustom, sceneChanged,
} from "../lib/api.js";
import { measure } from "../vision/exposure.js";

/** 畫面完全沒變時，最多隔這麼久還是送一次（保險） */
const IDLE_REFRESH_MS = 12000;

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

const PLAN_MS = () => cfg("PLAN_INTERVAL_MS", 700);
const LIGHT_MS = () => cfg("LIGHT_INTERVAL_MS", 6000);
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
    this.paused = false;
    /** 同時只讓一條路徑在飛，避免互相拖慢 */
    this.busy = false;
    this.controller = null;

    this.lastPlanSent = 0;
    this.lastCustomAt = 0;
    this.needsCustom = false;

    // 第一次光線分析要早一點跑，不然使用者要等 6 秒才看得到東西。
    // 設成「現在減去大部分的間隔」，第一輪就會輪到它。
    this.lastLightSent = performance.now() - LIGHT_MS() + 1200;
    /** 最近一次的光線結果，除錯面板會顯示 */
    this.lastLight = null;

    this.failures = 0;
    this.lastLatency = 0;
    this.lastExposure = null;
    this.stats = { plan: 0, light: 0, custom: 0, skip: 0 };

    document.addEventListener("visibilitychange", () => {
      this.paused = document.hidden;
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log(
      `[planner] 節奏 plan ${PLAN_MS()}ms · light ${LIGHT_MS()}ms · ` +
      `custom 冷卻 ${CUSTOM_MS()}ms`
    );
    this._tick();
  }

  stop() {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
  }

  /** 失敗越多次間隔越長，不要一直撞掛掉的後端 */
  get interval() {
    return Math.min(
      8000,
      PLAN_MS() * Math.pow(2, Math.min(this.failures, 4))
    );
  }

  /**
   * 計時基準是「上一件事做完之後」，不是「送出之時」。
   * 後端變慢時節奏會自動放慢，請求永遠不會堆積。
   */
  async _tick() {
    while (this.running) {
      await sleep(this.interval);
      if (!this.running) break;
      if (this.paused || this.busy) continue;

      const now = performance.now();

      // 優先序：動態版型 > 光線 > 主路徑
      // 前兩者比較少發生，讓它們先過，免得永遠排不到
      if (this.needsCustom && now - this.lastCustomAt > CUSTOM_MS()) {
        await this._runCustom();
      } else if (now - this.lastLightSent > LIGHT_MS()) {
        await this._runLight();
      } else {
        await this._runPlan();
      }
    }
  }

  // ── 主路徑 ──────────────────────────────────────

  async _runPlan() {
    // 畫面沒變就不送。但太久沒送還是補一次，
    // 免得使用者換了東西但變化太小沒被偵測到。
    const idle = performance.now() - this.lastPlanSent;
    if (!sceneChanged(this.video) && idle < IDLE_REFRESH_MS) {
      this.stats.skip++;
      return;
    }

    const img = grabFrame(this.video);
    if (!img) return;

    const ctx = this.getContext?.() ?? {};
    const plan = await this._send(
      requestPlan,
      {
        image: img,
        layouts: ctx.layouts ?? [],
        intent: ctx.intent ?? "product",
        current: ctx.current ?? null,
      },
      "plan"
    );

    this.lastPlanSent = performance.now();
    if (!plan) return;

    // 主路徑只回報「需要動態版型」，實際生成走另一條路
    this.needsCustom = !!plan.needs_custom;
    this.on.onPlan?.(plan);
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
    const exposure = measure(this.video, ctx.subjectBox ?? null);
    this.lastExposure = exposure;

    const light = await this._send(
      requestLight,
      { image: img, intent: ctx.intent ?? "product", exposure },
      "light"
    );

    this.lastLightSent = performance.now();
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
      return;
    }

    const ctx = this.getContext?.() ?? {};
    const res = await this._send(
      requestCustom,
      { image: img, intent: ctx.intent ?? "product", current: ctx.current },
      "custom"
    );

    this.lastCustomAt = performance.now();
    this.needsCustom = false;      // 不管成功與否都清掉，避免卡住
    if (res) this.on.onCustom?.(res);
  }

  // ── 共用的送出流程 ──────────────────────────────

  async _send(fn, payload, kind) {
    this.busy = true;
    this.controller = new AbortController();
    this.stats[kind]++;

    const t0 = performance.now();
    const res = await fn(payload, this.controller.signal);
    this.lastLatency = Math.round(performance.now() - t0);

    this.busy = false;
    this.controller = null;

    if (res) {
      this.failures = 0;
    } else {
      this.failures++;
      if (this.failures === 1) {
        console.warn(`VLM 無回應（${kind}），畫面維持現狀`);
      }
    }
    return res;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
