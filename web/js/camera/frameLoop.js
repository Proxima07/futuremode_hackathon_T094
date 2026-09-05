/**
 * 抽幀迴圈。
 *
 * 用 requestAnimationFrame 驅動，但節流到指定的 FPS。
 *
 * 為什麼要節流？
 * requestAnimationFrame 在手機上是 60fps。物件偵測跑不了那麼快，
 * 而且會把電力和發熱都拉滿。10fps 對引導來說已經非常流暢，
 * 因為使用者搬東西的速度遠慢於此。
 */

import { CONFIG } from "../lib/config.js";

/**
 * 開一個節流過的迴圈。
 *
 * @param {(dtMs:number) => void | Promise<void>} onFrame
 * @param {number} fps
 * @returns {{stop:()=>void, isRunning:()=>boolean}}
 */
export function startLoop(onFrame, fps = CONFIG.FPS) {
  const interval = 1000 / fps;
  let rafId = null;
  let last = 0;
  let running = true;
  /** 上一幀還沒處理完就跳過這一幀，避免堆積 */
  let busy = false;

  async function tick(now) {
    if (!running) return;
    rafId = requestAnimationFrame(tick);

    if (now - last < interval) return;
    if (busy) return;

    const dt = now - last;
    last = now;
    busy = true;
    try {
      await onFrame(dt);
    } catch (err) {
      // 一幀出錯不該讓整個迴圈停掉
      console.error("frameLoop:", err);
    } finally {
      busy = false;
    }
  }

  rafId = requestAnimationFrame(tick);

  return {
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    },
    isRunning: () => running,
  };
}

/**
 * 節流器。用於慢層：確保呼叫不會比 intervalMs 更頻繁。
 *
 * 和上面的迴圈不同，這個是「時間到了才讓它過」，
 * 用來限制送去後端的頻率。
 */
export function throttle(fn, intervalMs) {
  let last = 0;
  let pending = false;

  return async (...args) => {
    const now = performance.now();
    if (pending || now - last < intervalMs) return null;
    pending = true;
    last = now;
    try {
      return await fn(...args);
    } finally {
      pending = false;
    }
  };
}
