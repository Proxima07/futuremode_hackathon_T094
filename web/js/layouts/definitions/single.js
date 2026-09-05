import { PREFER } from "../schema.js";

/**
 * 單品主體。
 *
 * 畫面上只有一樣東西的時候用，這是最常見的商品照。
 *
 * 設計考量：
 *   - 主體佔畫面約 52% x 52%，符合「主商品佔三到五成」的慣例
 *   - 垂直中心放在 0.46，略高於正中央。正中央會顯得呆板，
 *     略高一點視覺上比較穩定（下方留白多一點像有支撐）
 *   - 四周都留白，物件不貼邊
 */
export const single = {
  id: "single",
  name: "單品主體",
  hint: "只有一樣商品時使用",
  minObjects: 1,
  maxObjects: 1,
  slots: [
    {
      id: "main",
      box: [0.22, 0.18, 0.78, 0.70],
      depth: 0,
      prefer: PREFER.HERO,
      label: "商品",
    },
  ],
};
