import { PREFER } from "../schema.js";

/**
 * 黃金分割構圖。
 *
 * 分割線落在 0.382 與 0.618，比三分法更偏心、留白更有張力。
 */
export const goldenGrid = {
  id: "golden_grid",
  name: "黃金分割",
  hint: "主體靠近黃金交點，適合有質感的留白",
  minObjects: 1,
  maxObjects: 2,
  guideOnly: true,
  composition: { type: "golden_grid" },
  slots: [
    {
      id: "main",
      box: [0.10, 0.18, 0.56, 0.59],
      anchor: [0.382, 0.382],
      depth: 0,
      prefer: PREFER.HERO,
      label: "主體靠黃金點",
    },
    {
      id: "secondary",
      box: [0.50, 0.40, 0.91, 0.73],
      anchor: [0.618, 0.618],
      depth: 0,
      prefer: PREFER.ANY,
      optional: true,
      label: "陪襯或留白",
    },
  ],
};
