/**
 * 版型的資料結構定義與驗證。
 *
 * 版型是這個專案的核心資產：它把「好看的商品照長什麼樣」
 * 變成一組寫死的座標，讓 AI 只需要做指派，不需要生成座標。
 *
 * 這帶來三個好處：
 *   1. 框永遠不會亂跳（座標是固定的）
 *   2. 構圖一定正確（是設計好的，不是模型猜的）
 *   3. AI 失效時退回預設版型，產品不會死
 */

/**
 * @typedef {Object} Slot 版型裡的一個位置
 * @property {string} id       位置代號，例如 "main" / "back" / "s1"
 * @property {number[]} box    [x1, y1, x2, y2]，一律 0~1 的比例
 * @property {number} depth    視覺深度。數字越大越靠前
 * @property {string} prefer   偏好放什麼物件，見 PREFER
 * @property {boolean} [optional] 可以空著不放東西
 * @property {string} [label]  給使用者看的中文說明
 */

/**
 * @typedef {Object} Layout 一個版型
 * @property {string} id
 * @property {string} name     中文名稱，顯示在 LayoutBadge
 * @property {string} hint     一句話說明什麼時候用
 * @property {number} minObjects 至少需要幾個物件
 * @property {number} maxObjects 最多容納幾個物件
 * @property {Slot[]} slots
 */

/** 位置對物件的偏好類型 */
export const PREFER = {
  /** 主角。畫面的重點，通常是面積最大或最有價值的那個 */
  HERO: "hero",
  /** 高的或大的。放在後方，才不會擋住別的東西 */
  TALL: "tall_or_large",
  /** 矮的或小的。放在前方，製造層次 */
  SHORT: "short_or_small",
  /** 沒有特別偏好，剩下的隨便放 */
  ANY: "any",
};

/** 座標的索引，避免程式裡出現看不懂的 box[2] */
export const X1 = 0, Y1 = 1, X2 = 2, Y2 = 3;

const GUIDE_TYPES = new Set([
  "thirds", "golden_grid", "golden_spiral", "triangle", "diagonal",
  "portrait_environment", "portrait_center",
]);

/**
 * 驗證一個版型定義是否合法。
 * 開發期用，抓自己手寫座標時的低級錯誤。
 *
 * @param {Layout} layout
 * @returns {string[]} 錯誤訊息陣列，空陣列代表沒問題
 */
export function validateLayout(layout) {
  const errors = [];
  const push = (m) => errors.push(`[${layout?.id ?? "?"}] ${m}`);

  if (!layout?.id) push("缺少 id");
  if (!layout?.name) push("缺少 name");
  if (!Array.isArray(layout?.slots) || layout.slots.length === 0) {
    push("slots 是空的");
    return errors;
  }

  if (layout.guideOnly && !GUIDE_TYPES.has(layout.composition?.type)) {
    push("構圖引導版型缺少有效的 composition.type");
  }

  const seen = new Set();
  let heroCount = 0;

  for (const s of layout.slots) {
    if (!s.id) push("有 slot 缺少 id");
    if (seen.has(s.id)) push(`slot id 重複：${s.id}`);
    seen.add(s.id);

    if (s.prefer === PREFER.HERO) heroCount++;

    const b = s.box;
    if (!Array.isArray(b) || b.length !== 4) {
      push(`${s.id} 的 box 格式錯誤`);
      continue;
    }
    if (b.some((v) => typeof v !== "number" || v < 0 || v > 1)) {
      push(`${s.id} 的座標必須是 0~1 的數字（不是像素）`);
    }
    if (b[X1] >= b[X2] || b[Y1] >= b[Y2]) {
      push(`${s.id} 的座標順序錯誤，應為 [x1,y1,x2,y2] 且 x1<x2, y1<y2`);
    }
    // 太小的框使用者對不準，太大的框沒有引導意義
    const area = (b[X2] - b[X1]) * (b[Y2] - b[Y1]);
    if (area < 0.02) push(`${s.id} 的框太小（面積 ${area.toFixed(3)}）`);
    if (area > 0.75) push(`${s.id} 的框太大（面積 ${area.toFixed(3)}）`);

    if (typeof s.depth !== "number") push(`${s.id} 缺少 depth`);

    if (layout.guideOnly) {
      const a = s.anchor;
      if (!Array.isArray(a) || a.length !== 2 ||
          a.some((v) => typeof v !== "number" || v < 0 || v > 1)) {
        push(`${s.id} 缺少有效的 anchor [x,y]`);
      }
    }
  }

  if (heroCount === 0) push("沒有任何 slot 標記為 hero");
  if (heroCount > 1) push(`有 ${heroCount} 個 hero slot，應該只有一個`);

  return errors;
}

/** 取得標記為 hero 的那個 slot */
export function heroSlot(layout) {
  return layout.slots.find((s) => s.prefer === PREFER.HERO) ?? null;
}

/** 依 depth 由後往前排序（back → front） */
export function slotsByDepth(layout) {
  return [...layout.slots].sort((a, b) => a.depth - b.depth);
}
