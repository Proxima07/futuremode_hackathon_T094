/**
 * 使用情境。
 *
 * 同一套引導機制可以服務不同領域，差別在於：
 *   - 適用哪些版型（美食的俯拍和二手商品的層次擺放不一樣）
 *   - 給 VLM 的情境提示（後端 prompts.py 的 INTENT_GUIDE）
 *
 * 新增情境的步驟：
 *   1. 這裡加一筆
 *   2. server/services/prompts.py 的 INTENT_GUIDE 加對應說明
 *   3. 需要新版型的話，在 layouts/definitions/ 加，並列進 layouts
 */

export const INTENTS = [
  {
    id: "food",
    name: "美食",
    icon: "🍜",
    hint: "拍出讓人想吃的餐點照",
    layouts: [
      "overhead", "angle45", "triangle", "golden_spiral", "rule_thirds",
      "diagonal", "golden_grid", "single", "detail", "flatlay",
    ],
  },
  {
    id: "secondhand_listing",
    name: "二手商品",
    icon: "📦",
    hint: "拍出賣得掉的商品照",
    layouts: [
      "single", "rule_thirds", "golden_grid", "diagonal",
      "hero_props", "golden_spiral", "flatlay", "detail",
    ],
  },
  {
    id: "product",
    name: "商品情境",
    icon: "✨",
    hint: "有質感的情境照",
    layouts: [
      "golden_spiral", "rule_thirds", "golden_grid", "diagonal", "triangle",
      "hero_props", "single", "flatlay", "angle45",
    ],
  },
];

export const DEFAULT_INTENT = INTENTS[0];

export function getIntent(id) {
  return INTENTS.find((i) => i.id === id) ?? DEFAULT_INTENT;
}
