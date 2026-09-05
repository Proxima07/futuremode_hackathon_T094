import test from "node:test";
import assert from "node:assert/strict";
import { PlanStabilizer } from "../web/js/planner/planStabilizer.js";

const subject = [{ slot: "main", item: "飲料杯", feature: "杯標中心" }];
const plan = (extra = {}) => ({ layout: "rule_thirds", fit: "good",
  alignment: "move", action: "move_left", placements: subject, remove: [], ...extra });
const ready = () => plan({ alignment: "ready", action: "none" });
const lock = () => { const s = new PlanStabilizer(); s.ingest(plan()); s.ingest(plan()); return s; };

test("two matching candidates lock once; minor adjustment noise does not delay consensus", () => {
  const s = new PlanStabilizer();
  assert.equal(s.ingest(plan({ fit: "adjust", adjust: { mirror: true, shift_y: .01 } })).kind, "candidate");
  assert.equal(s.ingest(plan({ fit: "adjust", adjust: { mirror: true, shift_y: .05 } })).kind, "locked");
  const fixed = JSON.stringify(s.lockedPlan);
  for (let i = 0; i < 6; i++) s.ingest(plan({ layout: "diagonal", fit: "adjust", adjust: { shift_y: -.08 } }));
  assert.equal(JSON.stringify(s.lockedPlan), fixed);
  assert.equal(s.phase, "guiding");
});

test("three different candidates select most recent but never force READY", () => {
  const s = new PlanStabilizer();
  for (const layout of ["single", "diagonal", "rule_thirds"]) s.ingest(plan({ layout }));
  assert.equal(s.lockedPlan.layout, "rule_thirds");
  assert.equal(s.phase, "guiding");
});

test("no subject clears search evidence; custom proposal needs its own consensus", () => {
  const s = new PlanStabilizer();
  s.ingest(plan());
  assert.equal(s.ingest(plan({ placements: [] })).kind, "no_subject");
  assert.equal(s.ingest(plan()).kind, "candidate");
  assert.equal(s.ingest(plan({ needs_custom: true })).kind, "candidate");
  assert.equal(s.ingest(plan({ needs_custom: true })).plan.needs_custom, true);
});

test("two READY votes in three accept a small wobble", () => {
  const s = lock();
  assert.equal(s.ingest(ready()).kind, "ready_pending");
  s.ingest(plan());
  assert.equal(s.ingest(ready()).kind, "ready");
  assert.equal(s.ingest(plan({ adjust: { shift_y: .08 } })).kind, "review_pending");
  assert.equal(s.phase, "ready");
});

test("subject loss and old evidence cannot be combined into READY", () => {
  const s = lock();
  s.ingest(ready(), 1000);
  s.ingest(plan({ alignment: "lost", placements: [] }), 2000);
  assert.equal(s.ingest(ready(), 3000).kind, "ready_pending");
  assert.equal(s.ingest(ready(), 15000).kind, "ready_pending");
  assert.equal(s.ingest(ready(), 16000).kind, "ready");
});

test("clutter or empty placements cannot assert ready", () => {
  const s = lock();
  for (let i = 0; i < 3; i++) s.ingest(readyWithClutter());
  assert.equal(s.phase, "guiding");
  s.ingest(plan({ alignment: "ready", placements: [] }));
  assert.equal(s.ingest(plan({ alignment: "ready", placements: [] })).kind, "replan");
});
function readyWithClutter() { return plan({ alignment: "ready", remove: ["無關線材"] }); }

test("new movement requires consecutive confirmations; a ready vote breaks the streak", () => {
  const s = lock();
  const right = plan({ action: "move_right" });
  assert.equal(s.ingest(right).kind, "guidance_pending");
  s.ingest(ready());
  assert.equal(s.ingest(right).kind, "guidance_pending");
  assert.equal(s.ingest(right).update, true);
  assert.equal(s.lastAction, "move_right");
  assert.equal(s.ingest(right).update, false);
});

test("clutter changes also need consensus even when action stays the same", () => {
  const s = lock();
  const p = plan({ remove: ["手機"] });
  assert.equal(s.ingest(p).kind, "guidance_pending");
  assert.equal(s.ingest(p).update, true);
  s.ingest(plan());
  assert.equal(s.ingest(plan()).update, true);
});

test("two lost observations replan, reset changes session", () => {
  const s = lock();
  const old = s.sessionId;
  const lost = plan({ alignment: "lost", placements: [] });
  assert.equal(s.ingest(lost).kind, "lost_pending");
  assert.equal(s.ingest(lost).kind, "replan");
  assert.ok(s.sessionId > old);
  assert.equal(s.lockedPlan, null);
});

test("view change preserves target but clears votes, reanalysis clears target", () => {
  const s = lock();
  s.ingest(ready()); s.ingest(ready());
  const target = s.lockedPlan;
  s.resumeGuiding();
  assert.equal(s.lockedPlan, target);
  assert.equal(s.phase, "guiding");
  assert.deepEqual(s.snapshot.readyHistory, []);
  s.reset();
  assert.equal(s.phase, "searching");
  assert.equal(s.lockedPlan, null);
});

test("low-frequency READY reviews need two misses and retain fixed targets", () => {
  const s = lock();
  s.ingest(ready(), 1000); s.ingest(ready(), 2000);
  assert.equal(s.ingest(plan(), 15000).kind, "review_pending");
  assert.equal(s.ingest(plan(), 28000).kind, "resumed");
  assert.equal(s.lockedPlan.layout, "rule_thirds");
});

test("ready window is never smaller than required votes; manual lock skips searching", () => {
  const s = new PlanStabilizer({ readyVotes: 3, readyWindow: 1 });
  s.forceLock(plan());
  s.ingest(ready()); s.ingest(ready());
  assert.equal(s.ingest(ready()).kind, "ready");
});
