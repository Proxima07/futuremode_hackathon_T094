import { PREFER } from "../schema.js";

/**
 * 斜四十五度。
 *
 * 食物攝影最常用的角度，適合有高度的東西：
 * 漢堡、蛋糕、拉麵、堆疊的鬆餅。
 *
 * 設計考量：
 *   - 這個角度會壓縮縱深，所以主體要放得比俯拍低一點，
 *     上方留白給背景，畫面才不會悶
 *   - back 只露出一部分，製造景深
 *   - front 放小東西（醬料碟、餐具），把視線帶回主體
 *   - depth 差異明顯，這是這個版型的重點
 */
export const angle45 = {
  id: "angle45",
  name: "斜 45 度",
  hint: "有高度的食物，斜上方拍",
  minObjects: 1,
  maxObjects: 3,
  slots: [
    {
      id: "back",
      box: [0.56, 0.15, 0.90, 0.38],
      depth: 0,
      prefer: PREFER.TALL,
      optional: true,
      label: "後方",
    },
    {
      id: "main",
      box: [0.20, 0.30, 0.74, 0.70],
      depth: 1,
      prefer: PREFER.HERO,
      label: "主餐",
    },
    {
      id: "front",
      box: [0.08, 0.60, 0.32, 0.75],
      depth: 2,
      prefer: PREFER.SHORT,
      optional: true,
      label: "前方小物",
    },
  ],
};
