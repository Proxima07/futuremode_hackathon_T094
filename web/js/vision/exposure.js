/**
 * 影像統計。純數學，跑在本機，零延遲。
 *
 * ────────────────────────────────────────────────
 * 算三類數字，各自解決一個問題
 *
 * 1. 亮度（主體 vs 背景）
 *    解決「場地裡有一盞強燈就壓過要拍的東西」。
 *    背光的定義是「主體比背景暗」，所以要分開算。
 *
 * 2. 顏色（色溫、飽和度、色相散布）
 *    解決「模型分不出這是色偏還是風格」。
 *    夜店的藍光、餐廳的暖黃燈在亮度上看起來都像「不理想」，
 *    但它們是風格。有了客觀的顏色數字，
 *    模型才能說「這是霓虹場景」而不是「色調異常」。
 *
 * 3. 反差（亮度的標準差）
 *    解決「光太硬還是太平」只能用猜的。
 *    標準差高 = 明暗落差大 = 硬光；低 = 平光。
 * ────────────────────────────────────────────────
 */

/** 取樣解析度。64x64 足夠算統計，而且很快 */
const N = 64;

const canvas = document.createElement("canvas");
canvas.width = N;
canvas.height = N;
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const CLIP_HIGH = 248;
const CLIP_LOW = 8;

export function measure(video, subjectBox = null) {
  if (!video?.videoWidth) return null;

  const crop = visibleRegion(video);

  // 只取使用者實際看得到的區域。
  // video 用 object-fit: cover，兩側或上下會被裁掉。
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, N, N);
  const data = ctx.getImageData(0, 0, N, N).data;

  const box = subjectBox ?? [0.3, 0.3, 0.7, 0.7];
  const bx1 = Math.round(box[0] * N);
  const by1 = Math.round(box[1] * N);
  const bx2 = Math.round(box[2] * N);
  const by2 = Math.round(box[3] * N);

  let sum = 0, sumSq = 0, hi = 0, lo = 0;
  let left = 0, right = 0, top = 0, bottom = 0;
  let subj = 0, bg = 0;
  let nL = 0, nR = 0, nT = 0, nB = 0, nS = 0, nG = 0;

  let sumR = 0, sumG = 0, sumB = 0, sumSat = 0;
  // 色相分布用十二個扇區統計，散布越廣代表光源越雜
  const hueBins = new Array(12).fill(0);
  let coloredPixels = 0;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      // 感知亮度。人眼對綠色最敏感，所以權重最高
      const v = (r * 299 + g * 587 + b * 114) / 1000;

      sum += v;
      sumSq += v * v;
      if (v >= CLIP_HIGH) hi++;
      if (v <= CLIP_LOW) lo++;

      sumR += r; sumG += g; sumB += b;

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      sumSat += sat;

      // 太暗或太灰的像素判斷不出色相，不列入統計
      if (sat > 0.18 && v > 20) {
        hueBins[Math.floor(hue(r, g, b, mx, mn) / 30) % 12]++;
        coloredPixels++;
      }

      if (x < N / 2) { left += v; nL++; } else { right += v; nR++; }
      if (y < N / 2) { top += v; nT++; } else { bottom += v; nB++; }

      if (x >= bx1 && x < bx2 && y >= by1 && y < by2) { subj += v; nS++; }
      else { bg += v; nG++; }
    }
  }

  const total = N * N;
  const to01 = (s, n) => +(s / Math.max(1, n) / 255).toFixed(3);

  const subject = to01(subj, nS);
  const background = to01(bg, nG);
  const mean = sum / total;

  const avgR = sumR / total, avgG = sumG / total, avgB = sumB / total;

  return {
    // ── 亮度 ──
    mean: +(mean / 255).toFixed(3),
    clipped_high: +(hi / total).toFixed(3),
    clipped_low: +(lo / total).toFixed(3),
    left: to01(left, nL),
    right: to01(right, nR),
    top: to01(top, nT),
    bottom: to01(bottom, nB),
    subject,
    background,
    subject_ratio: +(subject / Math.max(0.02, background)).toFixed(2),

    // ── 反差 ──
    // 亮度的標準差。高 = 明暗落差大（硬光），低 = 平光
    contrast: +(Math.sqrt(Math.max(0, sumSq / total - mean * mean)) / 255)
      .toFixed(3),

    // ── 顏色 ──
    // -1 是強烈冷色（藍），+1 是強烈暖色（橙）
    warmth: +((avgR - avgB) / Math.max(1, avgR + avgB)).toFixed(3),
    saturation: +(sumSat / total).toFixed(3),
    // 主色相 0~360，-1 代表整張畫面沒有明顯顏色
    dominant_hue: coloredPixels > total * 0.03
      ? dominantHue(hueBins)
      : -1,
    // 色相散布 0~1。高代表光源混雜（多種顏色的燈）
    hue_spread: +hueSpread(hueBins, coloredPixels).toFixed(3),
    color_ratio: +(coloredPixels / total).toFixed(3),
  };
}

function hue(r, g, b, mx, mn) {
  const d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function dominantHue(bins) {
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  return best * 30 + 15;
}

/**
 * 色相有多分散。
 *
 * 全部集中在一個扇區 → 0（單一色光，例如整片藍）
 * 平均分布在各扇區 → 接近 1（多種顏色的燈）
 */
function hueSpread(bins, totalColored) {
  if (totalColored < 40) return 0;
  let entropy = 0;
  for (const c of bins) {
    if (c === 0) continue;
    const p = c / totalColored;
    entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(bins.length);   // 正規化到 0~1
}

/**
 * 算出 object-fit: cover 之後，原始影格有哪一塊是看得到的。
 *
 * 使用者看不到的區域不該參與判斷，
 * 送給 VLM 的影像也要裁成一樣的範圍，
 * 否則模型會分析到螢幕上根本沒有的東西。
 */
export function visibleRegion(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const dw = video.clientWidth || vw;
  const dh = video.clientHeight || vh;

  const videoAspect = vw / vh;
  const displayAspect = dw / dh;

  if (videoAspect > displayAspect) {
    const sw = vh * displayAspect;
    return { sx: (vw - sw) / 2, sy: 0, sw, sh: vh };
  }
  const sh = vw / displayAspect;
  return { sx: 0, sy: (vh - sh) / 2, sw: vw, sh };
}

/** 給除錯面板看的兩行摘要 */
export function summarize(e) {
  if (!e) return "—";
  const tone =
    e.warmth > 0.12 ? "暖" : e.warmth < -0.12 ? "冷" : "中性";
  return (
    `主體 ${e.subject?.toFixed(2)} / 背景 ${e.background?.toFixed(2)}` +
    ` = ${e.subject_ratio} · 反差 ${e.contrast}\n` +
    `  色調 ${tone}(${e.warmth}) 飽和 ${e.saturation}` +
    ` 色相 ${e.dominant_hue < 0 ? "無" : e.dominant_hue + "°"}` +
    ` 散布 ${e.hue_spread}`
  );
}
