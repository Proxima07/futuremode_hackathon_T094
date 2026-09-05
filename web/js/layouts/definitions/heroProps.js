import { PREFER } from "../schema.js";

/**
 * 主角加配件。
 *
 * 有兩到三樣東西時用，這是最能展現「高放後、低放前」的版型。
 *
 * 設計考量：
 *   - 三個位置刻意讓相鄰的框「稍微重疊」，這是故意的。
 *     實體商品擺放時本來就會前後交疊，完全不重疊反而像貼紙。
 *   - back 在左上偏後，只露出一部分，製造深度
 *   - main 在中央偏下，是視覺重心
 *   - front 在右下，小配件，把視線帶出去形成斜線動線
 *   - depth 由 0 到 2，數字越大越靠前，繪製時要照這個順序疊
 */
export const heroProps = {
  id: "hero_props",
  name: "主角加配件",
  hint: "兩到三樣東西，需要前後層次時使用",
  minObjects: 2,
  maxObjects: 3,
  slots: [
    {
      id: "back",
      box: [0.10, 0.15, 0.48, 0.45],
      depth: 0,
      prefer: PREFER.TALL,
      label: "高的放後面",
    },
    {
      id: "main",
      box: [0.26, 0.35, 0.74, 0.73],
      depth: 1,
      prefer: PREFER.HERO,
      label: "主商品",
    },
    {
      id: "front",
      box: [0.66, 0.55, 0.92, 0.74],
      depth: 2,
      prefer: PREFER.SHORT,
      optional: true,
      label: "小的放前面",
    },
  ],
};
