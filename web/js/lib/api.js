/**
 * 後端 API 的呼叫封裝，以及影格處理。
 *
 * 原則：**永遠不要 throw。**
 * 網路失敗、後端掛掉、格式不對，一律回傳 null，
 * 呼叫端就繼續用目前的版型。使用者不該看到錯誤訊息。
 */

import { CONFIG } from "./config.js";
import { visibleRegion } from "../vision/exposure.js";

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
 * 把畫面縮成 32x32 的灰階指紋，和上一次比較平均差異。
 * 這是很便宜的計算（1024 個像素），但足以判斷
 * 「使用者是不是在搬東西」。
 *
 * 為什麼需要：原本每 800ms 就送一次 VLM，
 * 即使畫面完全沒動也照送。三分鐘的 Demo 就是兩百多次呼叫，
 * 白白吃掉額度和電力，而且結果也不會變。
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

/** 去除全域亮度偏移，降低自動曝光／燈光變化造成的誤觸發。不是物件追蹤器。 */
export function frameDifference(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  const mean = (v) => v.reduce((sum, n) => sum + n, 0) / v.length;
  const offset = mean(a) - mean(b);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i] - offset);
  return sum / a.length;
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
 * 請後端判斷版型、擺放方式與光線建議。
 *
 * @param {Object} payload
 * @param {string} payload.image      base64 JPEG
 * @param {string[]} payload.layouts  這個情境允許的版型 id
 * @param {string} payload.intent     使用情境
 * @param {Object} payload.current    目前正在用的版型，讓 VLM 判斷合不合用
 * @param {Object} payload.exposure   本機算出的曝光數字，補上 VLM 的盲點
 * @returns {Promise<Object|null>} 失敗回傳 null
 */
export async function requestPlan(payload, signal) {
  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allow_custom: true, ...payload }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.fallback ? null : data;
  } catch {
    return null;      // 包含使用者中止、斷網、逾時
  }
}

/**
 * 光線分析。獨立端點，前端用比較慢的節奏呼叫。
 * 房間的光線幾秒內不會變，不需要跟著物品位置一起重算。
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
