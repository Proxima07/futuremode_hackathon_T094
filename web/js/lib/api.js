/**
 * 後端 API 的呼叫封裝，以及影格處理。
 *
 * 原則：**永遠不要 throw。**
 * 網路失敗、後端掛掉、格式不對，一律回傳 null，
 * 呼叫端保留目前版型，並用簡短狀態說明重試；不把技術錯誤直接丟給使用者。
 */

import { CONFIG } from "./config.js";
import { visibleRegion } from "../vision/exposure.js";
import { frameDifference } from "../vision/frameFreshness.js";
export { frameDifference } from "../vision/frameFreshness.js";

// ── 影格擷取 ────────────────────────────────────────
// 重複使用同一組 canvas。
// 原本每次呼叫都 new 一個，每秒一次累積下來會造成記憶體壓力，
// 在手機上可能讓分頁被系統回收。

const frameCanvas = document.createElement("canvas");
// frameCanvas 只做 drawImage 與 toDataURL，不做 getImageData，
// 所以不要加 willReadFrequently，那會強制走 CPU 後端，變慢。
const frameCtx = frameCanvas.getContext("2d");

/** 縮圖用的小畫布，專門做畫面變化偵測 */
const THUMB = 32;
const thumbCanvas = document.createElement("canvas");
thumbCanvas.width = THUMB;
thumbCanvas.height = THUMB;
const thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true });

/**
 * 從 video 抓一幀，壓縮成 base64 JPEG。
 *
 * 長邊壓到 512。VLM 不需要高解析度判斷擺位，
 * 高解析度只會讓影像被切成更多區塊，token 暴增、延遲上升。
 */
export function grabFrame(video, maxEdge = CONFIG.IMAGE_MAX_EDGE) {
  if (!video?.videoWidth) return null;

  // 只送使用者實際看得到的範圍。
  // video 用 object-fit: cover，兩側或上下會被裁掉。
  // 送完整影格的話，VLM 會分析到螢幕上根本沒有的東西，
  // 它的建議就會對不上使用者看到的畫面。
  const { sx, sy, sw, sh } = visibleRegion(video);

  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);

  if (frameCanvas.width !== w || frameCanvas.height !== h) {
    frameCanvas.width = w;
    frameCanvas.height = h;
  }
  frameCtx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

  // 去掉 "data:image/jpeg;base64," 前綴，後端只要純 base64
  return frameCanvas.toDataURL("image/jpeg", 0.8).split(",")[1];
}

/**
 * 畫面變化偵測。
 *
 * 把畫面縮成 32x32 的灰階指紋，供排程器近似比較視野是否改變。
 * 它不辨識主體，也不能判定是否對準；靜止畫面仍須送模型確認構圖。
 */
let lastThumb = null;

export function sampleFrame(video) {
  if (!video?.videoWidth) return null;
  const { sx, sy, sw, sh } = visibleRegion(video);
  thumbCtx.drawImage(video, sx, sy, sw, sh, 0, 0, THUMB, THUMB);
  const data = thumbCtx.getImageData(0, 0, THUMB, THUMB).data;

  // 轉灰階
  const gray = new Uint8Array(THUMB * THUMB);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }

  return gray;
}

export function sceneChanged(video, threshold = 6) {
  const gray = sampleFrame(video);
  if (!gray) return false;
  const diff = frameDifference(gray, lastThumb);
  lastThumb = gray;
  return diff > threshold;
}

/** 強制下一次判定為「有變化」。切換版型後用得到 */
export function resetSceneMemory() {
  lastThumb = null;
}

// ── API ────────────────────────────────────────────

/**
 * 請後端選擇構圖，或檢查目前固定目標是否對準。
 *
 * @param {Object} payload
 * @param {string} payload.image      base64 JPEG
 * @param {string[]} payload.layouts  這個情境允許的版型 id
 * @param {string} payload.intent     使用情境
 * @param {Object} payload.current    目前正在用的版型，讓 VLM 判斷合不合用
 * @param {AbortSignal} signal       工作階段切換時中止請求
 * @param {Function} onResponse      回報 HTTP／fallback 狀態，與採用結果分開記錄
 * @returns {Promise<Object|null>} 失敗回傳 null
 */
export async function requestPlan(payload, signal, onResponse) {
  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allow_custom: true, ...payload }),
      signal,
    });
    if (!res.ok) {
      onResponse?.({ok: false, status: res.status, fallback: false});
      return null;
    }
    const data = await res.json();
    // HTTP 200 也可能是後端 fallback；收到了回覆不代表取得可用構圖。
    onResponse?.({ok: true, status: res.status, fallback: !!data?.fallback,
      reason: typeof data?.reason === "string" ? data.reason : ""});
    return data?.fallback ? null : data;
  } catch {
    return null;      // 包含使用者中止、斷網、逾時
  }
}

/**
 * 光線分析。獨立端點，由前端首次或偵測到持續的光線變化時呼叫。
 */
export async function requestLight(payload, signal) {
  try {
    const res = await fetch("/api/light", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.fallback ? null : data;
  } catch {
    return null;
  }
}

/**
 * 動態版型生成。只在 /api/plan 回報 needs_custom 時呼叫。
 * 座標很吃 token，所以不放在主路徑。
 */
export async function requestCustom(payload, signal) {
  try {
    const res = await fetch("/api/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.fallback ? null : data;
  } catch {
    return null;
  }
}

/** 熱身。冷啟動 1.4 秒、之後 0.3 秒 */
export function warmup() {
  fetch("/api/warmup", { method: "POST" }).catch(() => {});
}
