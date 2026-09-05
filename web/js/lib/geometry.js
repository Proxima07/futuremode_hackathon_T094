/**
 * 框的數學運算。
 *
 * 全部使用 0~1 的正規化座標，只有 toPixels 會轉成實際像素。
 * 這樣同一份版型在任何尺寸的螢幕上都能用。
 *
 * 框的格式一律是 [x1, y1, x2, y2]，左上到右下。
 */

export const X1 = 0, Y1 = 1, X2 = 2, Y2 = 3;

/** 把 0~1 的框轉成畫布上的像素 { x, y, w, h } */
export function toPixels(box, width, height) {
  return {
    x: box[X1] * width,
    y: box[Y1] * height,
    w: (box[X2] - box[X1]) * width,
    h: (box[Y2] - box[Y1]) * height,
  };
}

/** 框的中心點 [cx, cy] */
export function center(box) {
  return [(box[X1] + box[X2]) / 2, (box[Y1] + box[Y2]) / 2];
}

/** 框的寬與高 [w, h] */
export function size(box) {
  return [box[X2] - box[X1], box[Y2] - box[Y1]];
}

/** 框的面積 */
export function area(box) {
  const [w, h] = size(box);
  return Math.max(0, w) * Math.max(0, h);
}

/** 把數值夾在 [lo, hi] 之間 */
export function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}

/** 把整個框夾進畫面範圍內 */
export function clampBox(box) {
  return [
    clamp(box[X1]), clamp(box[Y1]),
    clamp(box[X2]), clamp(box[Y2]),
  ];
}

/** 兩個框的交集面積比（IoU），0 到 1 */
export function iou(a, b) {
  const x1 = Math.max(a[X1], b[X1]);
  const y1 = Math.max(a[Y1], b[Y1]);
  const x2 = Math.min(a[X2], b[X2]);
  const y2 = Math.min(a[Y2], b[Y2]);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (area(a) + area(b) - inter);
}

/**
 * 算出「實際框」離「目標框」有多遠。
 *
 * 這是引導的核心計算。回傳的資訊會被 toInstruction.js
 * 翻譯成「往左一點」「再靠近一點」這種人話。
 *
 * @returns {{dx:number, dy:number, dist:number, scale:number, iou:number}}
 *   dx, dy   中心點的偏移量（正 = 實際物件在目標的右邊 / 下面）
 *   dist     偏移的直線距離
 *   scale    大小比例。> 1 代表實際物件比目標框大（該退後）
 *   iou      重疊程度，給除錯用
 */
export function offset(actual, target) {
  const [ax, ay] = center(actual);
  const [tx, ty] = center(target);
  const dx = ax - tx;
  const dy = ay - ty;

  const [aw, ah] = size(actual);
  const [tw, th] = size(target);

  // 用面積的平方根比較，比單看寬或高穩定
  const scale = Math.sqrt((aw * ah) / Math.max(1e-6, tw * th));

  return {
    dx,
    dy,
    dist: Math.hypot(dx, dy),
    scale,
    iou: iou(actual, target),
  };
}

/**
 * 在兩個框之間插值，用於平滑過渡。
 *
 * AI 修正回來時直接換框會很突兀，用這個做動畫。
 *
 * @param {number} t 0 = 完全是 from，1 = 完全是 to
 */
export function lerpBox(from, to, t) {
  const k = clamp(t);
  return [
    from[X1] + (to[X1] - from[X1]) * k,
    from[Y1] + (to[Y1] - from[Y1]) * k,
    from[X2] + (to[X2] - from[X2]) * k,
    from[Y2] + (to[Y2] - from[Y2]) * k,
  ];
}

/**
 * 把偵測到的像素框轉成正規化座標。
 *
 * COCO-SSD 回傳的是 [x, y, width, height] 的像素值，
 * 格式和我們用的 [x1,y1,x2,y2] 不同，要轉換。
 */
export function fromDetection([x, y, w, h], srcW, srcH) {
  return clampBox([x / srcW, y / srcH, (x + w) / srcW, (y + h) / srcH]);
}
