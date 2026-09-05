import { PREFER } from "../schema.js";

/**
 * 對角線構圖。
 *
 * 適合長條物件、斜放餐點或需要速度感與方向性的畫面。
 */
export const diagonal = {
  id: "diagonal",
  name: "對角線",
  hint: "讓主體沿斜線延伸，增加方向感",
  minObjects: 1,
  maxObjects: 2,
  guideOnly: true,
  composition: { type: "diagonal" },
  slots: [
    {
      id: "main",
      box: [0.43, 0.22, 0.84, 0.58],
      anchor: [0.66, 0.40],
      depth: 0,
      prefer: PREFER.HERO,
      label: "主體沿斜線",
    },
    {
      id: "secondary",
      box: [0.14, 0.47, 0.51, 0.73],
      anchor: [0.32, 0.63],
      depth: 0,
      prefer: PREFER.ANY,
      optional: true,
      label: "陪襯延續動線",
    },
  ],
};
