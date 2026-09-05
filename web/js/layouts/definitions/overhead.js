import { PREFER } from "../schema.js";

/**
 * 俯拍。
 *
 * 從正上方往下拍，適合平面擺盤的食物：
 * 披薩、丼飯、火鍋、沙拉、平舖的一整桌。
 *
 * 設計考量：
 *   - 主餐略偏中心但不正中央，正中央會顯得呆板
 *   - 兩個配位在對角，形成斜線動線，眼睛會順著走
 *   - 俯拍沒有前後之分，所以 depth 都相同
 *   - 配位是 optional，只有一道菜時就空著
 */
export const overhead = {
  id: "overhead",
  name: "俯拍",
  hint: "平面擺盤的食物，從正上方拍",
  minObjects: 1,
  maxObjects: 3,
  slots: [
    {
      id: "main",
      box: [0.24, 0.24, 0.72, 0.66],
      depth: 0,
      prefer: PREFER.HERO,
      label: "主餐",
    },
    {
      id: "s1",
      box: [0.70, 0.15, 0.94, 0.36],
      depth: 0,
      prefer: PREFER.ANY,
      optional: true,
      label: "配菜",
    },
    {
      id: "s2",
      box: [0.06, 0.56, 0.30, 0.74],
      depth: 0,
      prefer: PREFER.ANY,
      optional: true,
      label: "飲料",
    },
  ],
};
