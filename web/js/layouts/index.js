/**
 * 版型註冊表。
 *
 * 新增版型的步驟：
 *   1. 在 definitions/ 建一個新檔案
 *   2. 在下面 import 進來
 *   3. 加進 ALL 陣列
 *
 * 就這樣，其他地方不用改。
 */

import { single } from "./definitions/single.js";
import { heroProps } from "./definitions/heroProps.js";
import { flatlay } from "./definitions/flatlay.js";
import { detail } from "./definitions/detail.js";
import { overhead } from "./definitions/overhead.js";
import { angle45 } from "./definitions/angle45.js";
import { validateLayout } from "./schema.js";

/** 所有版型，順序不重要 */
export const ALL = [single, heroProps, flatlay, detail, overhead, angle45];

/** 依情境過濾出可用的版型，順序照情境的偏好 */
export function layoutsFor(intent) {
  const ids = intent?.layouts ?? [];
  const picked = ids.map((id) => BY_ID[id]).filter(Boolean);
  return picked.length ? picked : ALL;
}

/** id → layout 的查表 */
const BY_ID = Object.fromEntries(ALL.map((l) => [l.id, l]));

/**
 * 取得版型。找不到就回傳預設版型，永遠不會回傳 null。
 * 這很重要：VLM 可能吐出不存在的 id，畫面不能因此壞掉。
 */
export function getLayout(id) {
  return BY_ID[id] ?? DEFAULT_LAYOUT;
}

/** VLM 失效、或什麼都判斷不出來時的保底版型 */
export const DEFAULT_LAYOUT = single;

/** 給後端的允許清單，會放進 /api/plan 的請求裡 */
export const LAYOUT_IDS = ALL.map((l) => l.id);

/** 版型是否存在。validate 用 */
export function isValidLayoutId(id) {
  return Object.hasOwn(BY_ID, id);
}

// ── 開發期自我檢查 ──────────────────────────────────
// 手寫座標很容易打錯，在 console 直接噴出來比較快發現。
// 上線前可以拿掉，但它幾乎不花時間，留著也無妨。
const problems = ALL.flatMap(validateLayout);
if (problems.length > 0) {
  console.warn("版型定義有問題：\n" + problems.join("\n"));
}
