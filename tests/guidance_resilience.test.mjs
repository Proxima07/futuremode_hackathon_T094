/**
 * 引導階段的韌性：
 *   1. 模型漏填 placements 不該被當成主體不見
 *   2. 手震不該被當成明確位移
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PlanStabilizer, PLAN_PHASE } from "../web/js/planner/planStabilizer.js";
import { comparePreviewFrames } from "../web/js/vision/frameFreshness.js";

const SIZE = 32;

/** 產生一張有紋理的假畫面（模擬桌面／滑鼠墊那種高紋理背景） */
function scene(seed = 1) {
  const px = new Array(SIZE * SIZE);
  let s = seed;
  for (let i = 0; i < px.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    px[i] = 40 + (s % 180);
  }
  return px;
}

/** 把整張畫面平移 dx, dy 個像素，模擬手震 */
function shift(px, dx, dy) {
  const out = new Array(px.length).fill(0);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sy = Math.min(SIZE - 1, Math.max(0, y - dy));
      const sx = Math.min(SIZE - 1, Math.max(0, x - dx));
      out[y * SIZE + x] = px[sy * SIZE + sx];
    }
  }
  return out;
}

// ── 手震容忍 ────────────────────────────────────

test("平移一到三個縮圖像素的手震仍視為同一畫面", () => {
  const base = scene(7);
  for (const [dx, dy] of [[1, 0], [0, 1], [2, 1], [-2, 2], [3, 0], [0, -3]]) {
    const r = comparePreviewFrames(base, shift(base, dx, dy));
    assert.equal(r.fresh, true, `平移 (${dx},${dy}) 不該判定為移動`);
  }
});

test("整體亮度改變但場景相同，仍視為同一畫面", () => {
  const base = scene(11);
  const brighter = base.map((v) => Math.min(255, v + 28));
  assert.equal(comparePreviewFrames(base, brighter).fresh, true);
});

test("換成完全不同的場景仍然抓得到", () => {
  assert.equal(comparePreviewFrames(scene(3), scene(999)).fresh, false);
});

test("搜尋半徑可以調小，回到嚴格模式", () => {
  const base = scene(5);
  const far = shift(base, 3, 3);
  assert.equal(comparePreviewFrames(base, far, { radius: 1 }).fresh, false,
    "半徑 1 時三像素平移應判定為移動");
  assert.equal(comparePreviewFrames(base, far, { radius: 3 }).fresh, true);
});

// ── placements 漏填 ─────────────────────────────

function lockGuiding() {
  const s = new PlanStabilizer();
  const proposal = {
    fit: "good", layout: "detail",
    placements: [{ slot: "detail", item: "白色滑鼠" }],
    alignment: "move", action: "move_closer", advice: "再靠近一點",
  };
  s.ingest(proposal, performance.now());
  s.ingest(proposal, performance.now());
  assert.equal(s.phase, PLAN_PHASE.GUIDING, "兩次一致後應鎖定目標");
  return s;
}

test("引導階段漏填 placements 不該判定主體不見", () => {
  const s = lockGuiding();
  // 模型只回 alignment 與 action，沒有帶 placements
  const r = s.ingest(
    { alignment: "move", action: "move_left", advice: "往左一點" },
    performance.now()
  );
  assert.notEqual(r.kind, "lost_pending", "不該進入主體不見的流程");
  assert.notEqual(r.kind, "replan");
  assert.equal(s.phase, PLAN_PHASE.GUIDING, "應該留在引導階段");
});

test("漏填 placements 時沿用上一次已知的主體", () => {
  const s = lockGuiding();
  s.ingest({ alignment: "ready", action: "none", advice: "" }, performance.now());
  s.ingest({ alignment: "ready", action: "none", advice: "" }, performance.now());
  assert.equal(s.phase, PLAN_PHASE.READY, "漏填 placements 也要能進入可拍攝");
});

test("模型明確說 lost 才真的重新規劃", () => {
  const s = lockGuiding();
  s.ingest({ alignment: "lost", placements: [] }, performance.now());
  s.ingest({ alignment: "lost", placements: [] }, performance.now());
  assert.equal(s.phase, PLAN_PHASE.SEARCHING, "連續兩次明確 lost 才重新選構圖");
});

test("重新規劃後不會沿用上一個場景的主體", () => {
  const s = lockGuiding();
  s.reset();
  const r = s.ingest({ alignment: "move", action: "move_left" }, performance.now());
  assert.equal(r.kind, "no_subject", "全新工作階段沒有已知主體時仍要保守");
});
