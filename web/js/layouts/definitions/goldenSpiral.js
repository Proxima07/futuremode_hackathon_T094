import { PREFER } from "../schema.js";

/**
 * 黃金螺旋構圖。
 *
 * 主體放在螺旋眼，其他元素沿曲線形成視線流動。
 */
export const goldenSpiral = {
  id: "golden_spiral",
  name: "黃金螺旋",
  hint: "主體放在螺旋眼，讓視線沿曲線進入畫面",
  minObjects: 1,
  maxObjects: 2,
  guideOnly: true,
  composition: { type: "golden_spiral" },
  slots: [
    {
      id: "main",
      box: [0.42, 0.20, 0.82, 0.57],
      anchor: [0.618, 0.382],
      depth: 0,
      prefer: PREFER.HERO,
      label: "主體放螺旋眼",
    },
    {
      id: "flow",
      box: [0.13, 0.48, 0.49, 0.73],
      anchor: [0.32, 0.63],
      depth: 0,
      prefer: PREFER.ANY,
      optional: true,
      label: "陪襯順著曲線",
    },
  ],
};
