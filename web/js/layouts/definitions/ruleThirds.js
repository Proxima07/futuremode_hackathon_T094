import { PREFER } from "../schema.js";

/**
 * 三分法構圖。
 *
 * 適合單一主體、人物與商品、餐點帶環境的畫面。
 * 不要求物件排出前後高低，只用九宮格交點建立視覺重心。
 */
export const ruleThirds = {
  id: "rule_thirds",
  name: "三分法",
  hint: "主體靠近九宮格交點，保留環境與留白",
  minObjects: 1,
  maxObjects: 2,
  guideOnly: true,
  composition: { type: "thirds" },
  slots: [
    {
      id: "main",
      box: [0.08, 0.16, 0.54, 0.58],
      anchor: [1 / 3, 1 / 3],
      depth: 0,
      prefer: PREFER.HERO,
      label: "主體靠交點",
    },
    {
      id: "secondary",
      box: [0.48, 0.38, 0.92, 0.72],
      anchor: [2 / 3, 2 / 3],
      depth: 0,
      prefer: PREFER.ANY,
      optional: true,
      label: "陪襯或留白",
    },
  ],
};
