/** 32×32 預覽指紋的近似比較；只處理曝光與小幅手震，不是主體追蹤器。 */
export function frameDifference(a, b) {
  if (!a || !b || !a.length || a.length !== b.length) return Infinity;
  const mean = (v) => v.reduce((sum, n) => sum + n, 0) / v.length;
  const offset = mean(a) - mean(b);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i] - offset);
  return sum / a.length;
}

export function comparePreviewFrames(a, b, threshold = 12) {
  const rawDifference = frameDifference(a, b);
  if (!Number.isFinite(rawDifference)) return { fresh: false, difference: Infinity, rawDifference };
  const size = Math.sqrt(a.length);
  if (!Number.isInteger(size) || size < 8) {
    return { fresh: rawDifference <= threshold, difference: rawDifference, rawDifference };
  }
  // 只允許一個縮圖像素的整體平移（32×32 約為畫寬 3%）。
  // 避免高紋理背景手震一點點，就被逐像素差異誤當成完全不同的畫面。
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, n = 0;
      for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        const av = a[y * size + x], bv = b[(y + dy) * size + x + dx];
        sa += av; sb += bv; saa += av * av; sbb += bv * bv; n++;
      }
      const ma = sa / n, mb = sb / n;
      const va = Math.max(0, saa / n - ma * ma), vb = Math.max(0, sbb / n - mb * mb);
      const gain = vb > 16 ? Math.max(.67, Math.min(1.5, Math.sqrt(va / vb))) : 1;
      let sum = 0;
      for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        sum += Math.abs((a[y * size + x] - ma) - gain * (b[(y + dy) * size + x + dx] - mb));
      }
      best = Math.min(best, sum / n);
    }
  }
  return { fresh: best <= threshold, difference: best, rawDifference };
}
