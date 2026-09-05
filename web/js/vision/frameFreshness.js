/**
 * 32×32 預覽指紋的近似比較。
 *
 * 只處理曝光變化與手震，**不是主體追蹤器**。
 * 它回答的問題是「這兩張畫面看起來是不是同一個場景」，
 * 不是「主體移到哪裡了」。
 *
 * ────────────────────────────────────────────────
 * 搜尋半徑為什麼要放寬
 *
 * 原本只容許 ±1 個縮圖像素的整體平移。
 * 32×32 的一個像素約是畫寬的 3%——手持拍攝隨便晃一下就超過，
 * 於是每次手震都被當成「畫面明顯移動」，
 * 引導提示被清掉、可拍攝狀態被撤銷。
 *
 * 放寬到 ±3 個像素（約畫寬 9%），這是手持穩定拍攝的實際範圍。
 * 真正的移動（轉向、換物件、走動）遠大於這個幅度，仍然抓得到。
 *
 * 代價是每次比較從 9 個位移試到 49 個。
 * 32×32 只有一千個像素，即使 49 次也不到一毫秒，可以接受。
 * ────────────────────────────────────────────────
 */

export function frameDifference(a, b) {
  if (!a || !b || !a.length || a.length !== b.length) return Infinity;
  const mean = (v) => v.reduce((sum, n) => sum + n, 0) / v.length;
  const offset = mean(a) - mean(b);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i] - offset);
  return sum / a.length;
}

/** 位移搜尋半徑，單位是縮圖像素。3 約等於畫寬 9%。 */
export const DEFAULT_RADIUS = 3;
/** 差異門檻。低於這個值視為同一個場景。 */
export const DEFAULT_THRESHOLD = 16;

/**
 * @param {number[]} a  先前的指紋
 * @param {number[]} b  目前的指紋
 * @param {number|{threshold?:number, radius?:number}} [options]
 *        給數字的話當成 threshold，維持舊的呼叫方式
 */
export function comparePreviewFrames(a, b, options = {}) {
  const {
    threshold = DEFAULT_THRESHOLD,
    radius = DEFAULT_RADIUS,
  } = typeof options === "number" ? { threshold: options } : options;

  const rawDifference = frameDifference(a, b);
  if (!Number.isFinite(rawDifference)) {
    return { fresh: false, difference: Infinity, rawDifference, shift: null };
  }

  const size = Math.sqrt(a.length);
  if (!Number.isInteger(size) || size < 8) {
    return {
      fresh: rawDifference <= threshold,
      difference: rawDifference,
      rawDifference,
      shift: null,
    };
  }

  // 邊界要留出搜尋半徑，否則取樣會超出陣列範圍
  const pad = Math.max(1, Math.min(radius, Math.floor(size / 4)));

  let best = Infinity;
  let bestShift = null;

  for (let dy = -pad; dy <= pad; dy++) {
    for (let dx = -pad; dx <= pad; dx++) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, n = 0;
      for (let y = pad; y < size - pad; y++) {
        for (let x = pad; x < size - pad; x++) {
          const av = a[y * size + x];
          const bv = b[(y + dy) * size + x + dx];
          sa += av; sb += bv; saa += av * av; sbb += bv * bv; n++;
        }
      }
      const ma = sa / n, mb = sb / n;
      const va = Math.max(0, saa / n - ma * ma);
      const vb = Math.max(0, sbb / n - mb * mb);

      // 補償整體曝光差異。自動曝光會讓同一個場景的亮度跳動，
      // 不補償的話那也會被當成「畫面變了」。
      const gain = vb > 16
        ? Math.max(.67, Math.min(1.5, Math.sqrt(va / vb)))
        : 1;

      let sum = 0;
      for (let y = pad; y < size - pad; y++) {
        for (let x = pad; x < size - pad; x++) {
          sum += Math.abs(
            (a[y * size + x] - ma) - gain * (b[(y + dy) * size + x + dx] - mb)
          );
        }
      }
      const score = sum / n;
      if (score < best) { best = score; bestShift = { dx, dy }; }
    }
  }

  return {
    fresh: best <= threshold,
    difference: best,
    rawDifference,
    shift: bestShift,
  };
}
