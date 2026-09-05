/**
 * 版型的調整與動態版型的套用。
 *
 * 兩種來源：
 *   adjust —— VLM 給的受約束參數（鏡射、縮放、平移）
 *   custom —— VLM 生成的完整版型
 *
 * 為什麼 adjust 只給參數而不給座標：
 * 自由生成的座標每次都不一樣，框會亂跳，而且模型沒有
 * 構圖的先驗知識，給的數字只是「看起來像那麼回事」。
 * 參數化調整保有版型的構圖正確性，又能適應實際場景。
 * 詳見 docs/05-DECISIONS.md 的 D1。
 */

import { clamp } from "../lib/geometry.js";

/** 安全區。上方有版型標籤，下方有提示條與快門 */
const SAFE = { top: 0.12, bottom: 0.76, left: 0.04, right: 0.96 };

/**
 * 把調整參數套用到版型上。
 *
 * @param {Object} layout  原始版型
 * @param {Object|null} adjust  { mirror, flip_y, scale, shift_x, shift_y }
 * @returns {Object} 新的版型物件（不會改動原始的）
 */
export function applyAdjust(layout, adjust) {
  if (!adjust) return layout;

  const {
    mirror = false, flip_y = false,
    scale = 1, shift_x = 0, shift_y = 0,
  } = adjust;
  if (!mirror && !flip_y && Math.abs(scale - 1) < 0.02 &&
      Math.abs(shift_x) < 0.01 && Math.abs(shift_y) < 0.01) {
    return layout;
  }

  const transformPoint = ([px, py]) => {
    let x = mirror ? 1 - px : px;
    let y = flip_y ? 1 - py : py;
    x = 0.5 + (x - 0.5) * scale + shift_x;
    y = 0.5 + (y - 0.5) * scale + shift_y;
    return [
      clamp(x, SAFE.left, SAFE.right),
      clamp(y, SAFE.top, SAFE.bottom),
    ];
  };

  const slots = layout.slots.map((s) => {
    let [x1, y1, x2, y2] = s.box;

    if (mirror) {
      [x1, x2] = [1 - x2, 1 - x1];
    }
    if (flip_y) {
      [y1, y2] = [1 - y2, 1 - y1];
    }

    if (scale !== 1) {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const w = (x2 - x1) * scale / 2;
      const h = (y2 - y1) * scale / 2;
      x1 = cx - w; x2 = cx + w;
      y1 = cy - h; y2 = cy + h;
    }

    x1 += shift_x; x2 += shift_x;
    y1 += shift_y; y2 += shift_y;

    return {
      ...s,
      box: fitSafe([x1, y1, x2, y2]),
      ...(s.anchor ? { anchor: transformPoint(s.anchor) } : {}),
    };
  });

  // 構圖線與 slot 使用同一組轉換，確保 LLM 做鏡射、縮放或平移時，
  // 畫面上的交點／螺旋與實際指派位置不會分離。
  const composition = layout.composition
    ? {
        ...layout.composition,
        transform: { mirror, flip_y, scale, shift_x, shift_y },
      }
    : undefined;

  return {
    ...layout,
    slots,
    ...(composition ? { composition } : {}),
    adjustment: { mirror, flip_y, scale, shift_x, shift_y },
    adjusted: true,
  };
}

/**
 * 把框推回安全區。
 *
 * 優先「平移」而不是「裁切」，這樣框的大小不會變形。
 * 平移也放不下的時候才縮小。
 */
function fitSafe(box) {
  let [x1, y1, x2, y2] = box;
  let w = x2 - x1;
  let h = y2 - y1;

  // 太大就先縮到放得下
  const maxW = SAFE.right - SAFE.left;
  const maxH = SAFE.bottom - SAFE.top;
  if (w > maxW) { const k = maxW / w; const cx = (x1 + x2) / 2; w *= k; x1 = cx - w / 2; x2 = cx + w / 2; }
  if (h > maxH) { const k = maxH / h; const cy = (y1 + y2) / 2; h *= k; y1 = cy - h / 2; y2 = cy + h / 2; }

  // 平移回範圍內
  if (x1 < SAFE.left) { x2 += SAFE.left - x1; x1 = SAFE.left; }
  if (x2 > SAFE.right) { x1 -= x2 - SAFE.right; x2 = SAFE.right; }
  if (y1 < SAFE.top) { y2 += SAFE.top - y1; y1 = SAFE.top; }
  if (y2 > SAFE.bottom) { y1 -= y2 - SAFE.bottom; y2 = SAFE.bottom; }

  return [clamp(x1), clamp(y1), clamp(x2), clamp(y2)];
}

/**
 * 把 VLM 生成的動態版型變成正式的版型物件。
 *
 * 後端 validate.py 已經做過一輪修正（夾安全區、去重疊、
 * 確保有主角），這裡只補上前端需要的欄位。
 */
export function toLayout(custom, fallbackId = "custom") {
  if (!custom?.slots?.length) return null;
  return {
    id: fallbackId,
    name: custom.name || "臨時版型",
    hint: "由 AI 依現場情況產生",
    minObjects: 1,
    maxObjects: custom.slots.length,
    dynamic: true,
    slots: custom.slots.map((s, i) => ({
      id: s.id ?? `s${i + 1}`,
      box: fitSafe(s.box),
      depth: s.depth ?? i,
      prefer: s.prefer ?? "any",
      label: s.label ?? "",
      optional: false,
    })),
  };
}
