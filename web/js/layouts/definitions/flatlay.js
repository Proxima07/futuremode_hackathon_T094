import { PREFER } from "../schema.js";

/**
 * 平拍排列。
 *
 * 三樣以上、而且高度差不多的東西（開箱照、一整組配件）。
 *
 * 設計考量：
 *   - 主角置中且略大，四個配件對稱分布在四角
 *   - 所有 depth 相同，因為平拍是俯視，沒有前後之分
 *   - 四角的框都是 optional，東西不夠時就空著，
 *     不要硬逼使用者去湊滿
 *   - 框之間留有間隔，平拍最忌諱東西黏在一起
 */
export const flatlay = {
  id: "flatlay",
  name: "平拍排列",
  hint: "三樣以上、高度相近時使用",
  minObjects: 3,
  maxObjects: 5,
  slots: [
    {
      id: "main",
      box: [0.32, 0.33, 0.68, 0.59],
      depth: 0,
      prefer: PREFER.HERO,
      label: "主商品",
    },
    { id: "s1", box: [0.08, 0.15, 0.35, 0.32], depth: 0,
      prefer: PREFER.ANY, optional: true, label: "配件" },
    { id: "s2", box: [0.65, 0.15, 0.92, 0.32], depth: 0,
      prefer: PREFER.ANY, optional: true, label: "配件" },
    { id: "s3", box: [0.08, 0.60, 0.35, 0.75], depth: 0,
      prefer: PREFER.ANY, optional: true, label: "配件" },
    { id: "s4", box: [0.65, 0.60, 0.92, 0.75], depth: 0,
      prefer: PREFER.ANY, optional: true, label: "配件" },
  ],
};
