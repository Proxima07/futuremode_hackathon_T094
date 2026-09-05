/**
 * 規則指派：決定哪個物件該放進哪個位置。
 *
 * 這一層完全不需要 AI，是純計算，零延遲。
 * 使用者一打開相機立刻就有框可以對，AI 只是之後來修正。
 *
 * 這是整個專案最重要的風險控管：AI 掛掉，產品還是能用。
 *
 * ────────────────────────────────────────────────
 * 指派的優先序（順序很重要，弄反了結果會很怪）
 *
 *   1. 先挑主角  — 面積最大的那個
 *   2. 再排剩下的 — 依高度排序，高的放後面、矮的放前面
 *
 * 為什麼主角要先挑？
 * 因為「面積最大」和「高度最高」常常是同一個物件。
 * 如果先排高度，最大的那個會被塞到 back，主角位置就空了。
 * ────────────────────────────────────────────────
 */

import { PREFER, heroSlot, slotsByDepth } from "./schema.js";

/** 面積小於這個比例的物件視為雜物，不參與指派 */
const MIN_AREA = 0.008;

/**
 * @typedef {Object} Detection
 * @property {string} id
 * @property {string} label
 * @property {number[]} box      [x1,y1,x2,y2] 0~1
 * @property {number} h_ratio    高度佔畫面比例
 * @property {number} area       面積佔畫面比例
 */

/**
 * @typedef {Object} Plan 一份擺放計畫
 * @property {string} layout             版型 id
 * @property {Object<string,?string>} assign  slot id → 物件 id（或 null）
 * @property {string[]} remove           建議移除的物件 id
 * @property {string} source             "rule" 或 "vlm"
 */

/**
 * 依物件數量挑一個合適的版型。
 *
 * @param {Detection[]} detections
 * @param {Layout[]} layouts 可用的版型清單
 * @returns {Layout}
 */
export function pickLayout(detections, layouts) {
  const n = detections.filter((d) => d.area >= MIN_AREA).length;

  // 找出容納得下這個數量的版型，取 slot 數最接近的那個
  const fits = layouts.filter(
    (l) => n >= l.minObjects && n <= l.maxObjects
  );

  if (fits.length > 0) {
    return fits.reduce((best, l) =>
      Math.abs(l.slots.length - n) < Math.abs(best.slots.length - n)
        ? l
        : best
    );
  }

  // 物件太多，用容量最大的；一個都沒有，用最小的
  return n > 0
    ? layouts.reduce((a, b) => (a.maxObjects >= b.maxObjects ? a : b))
    : layouts.reduce((a, b) => (a.minObjects <= b.minObjects ? a : b));
}

/**
 * 把物件指派進版型的位置。
 *
 * @param {Detection[]} detections
 * @param {Layout} layout
 * @returns {Plan}
 */
export function assign(detections, layout) {
  const assign = {};
  const remove = [];

  for (const s of layout.slots) assign[s.id] = null;

  // 太小的東西直接當雜物
  const usable = [];
  for (const d of detections) {
    if (d.area < MIN_AREA) remove.push(d.id);
    else usable.push(d);
  }

  if (usable.length === 0) {
    return { layout: layout.id, assign, remove, source: "rule" };
  }

  const pool = [...usable];

  // ── 第一步：挑主角 ───────────────────────────────
  const hero = heroSlot(layout);
  if (hero) {
    // 面積最大的當主角
    let pick = pool[0];
    for (const d of pool) if (d.area > pick.area) pick = d;

    assign[hero.id] = pick.id;
    pool.splice(pool.indexOf(pick), 1);
  }

  // ── 第二步：剩下的依高度排進其他位置 ──────────────
  // 高的優先放到 depth 小的位置（後面）
  pool.sort((a, b) => b.h_ratio - a.h_ratio);

  const rest = slotsByDepth(layout).filter((s) => s.prefer !== PREFER.HERO);

  for (const slot of rest) {
    if (pool.length === 0) break;
    assign[slot.id] = pool.shift().id;
  }

  // ── 第三步：位置不夠用的物件，建議移除 ──────────────
  // 畫面裡東西太多本來就是商品照的大忌
  for (const d of pool) remove.push(d.id);

  return { layout: layout.id, assign, remove, source: "rule" };
}

/**
 * 一步到位：挑版型 + 指派。這是 rulePlanner 主要呼叫的函式。
 *
 * @param {Detection[]} detections
 * @param {Layout[]} layouts
 * @returns {Plan}
 */
export function planByRule(detections, layouts) {
  const layout = pickLayout(detections, layouts);
  return assign(detections, layout);
}
