import { PREFER } from "../schema.js";

/**
 * 三角構圖。
 *
 * 適合三樣物件、一盤主餐加兩個陪襯，畫面穩定而集中。
 */
export const triangle = {
  id: "triangle",
  name: "三角構圖",
  hint: "元素沿三個頂點安排，畫面穩定集中",
  minObjects: 1,
  maxObjects: 3,
  guideOnly: true,
  composition: { type: "triangle" },
  slots: [
    {
      id: "main",
      box: [0.34, 0.17, 0.66, 0.51],
      anchor: [0.50, 0.28],
      depth: 0,
      prefer: PREFER.HERO,
      label: "主體",
    },
    {
      id: "left",
      box: [0.10, 0.45, 0.46, 0.73],
      anchor: [0.24, 0.68],
      depth: 0,
      prefer: PREFER.ANY,
      optional: true,
      label: "左側陪襯",
    },
    {
      id: "right",
      box: [0.54, 0.45, 0.90, 0.73],
      anchor: [0.76, 0.68],
      depth: 0,
      prefer: PREFER.ANY,
      optional: true,
      label: "右側陪襯",
    },
  ],
};
