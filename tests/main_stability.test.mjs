/** Execute the actual main.js handlers with a small DOM/camera stub, no browser or server. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PlanStabilizer, PLAN_PHASE } from "../web/js/planner/planStabilizer.js";
import { LayoutBadge } from "../web/js/ui/layoutBadge.js";
import { HintBar } from "../web/js/ui/hintBar.js";
import { INTENTS, DEFAULT_INTENT } from "../web/js/intents.js";
import { ALL, getLayout, layoutsFor } from "../web/js/layouts/index.js";
import { applyAdjust, toLayout } from "../web/js/layouts/adjust.js";
import { LIGHT_TEXT } from "../web/js/guidance/phrases.js";
import { CONFIG } from "../web/js/lib/config.js";

function element() {
  return { dataset: {}, style: {}, textContent: "", children: [], disabled: false,
    addEventListener() {}, replaceChildren(...children) { this.children = children; },
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} } };
}

function app() {
  const els = new Map();
  const document = { getElementById(id) { if (!els.has(id)) els.set(id, element()); return els.get(id); }, createElement: element };
  // LayoutBadge's native module resolves global document, so use this test DOM as well.
  globalThis.document = document;
  const source = readFileSync(new URL("../web/js/main.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?$/gm, "");
  const sandbox = { document, window: {addEventListener() {}}, console: {log() {}, warn() {}, error() {}},
    performance, setTimeout, clearInterval, setInterval,
    PlanStabilizer, PLAN_PHASE, LayoutBadge, HintBar, INTENTS, DEFAULT_INTENT,
    ALL, getLayout, layoutsFor, applyAdjust, toLayout, LIGHT_TEXT, CONFIG,
    resetSceneMemory() {}, camera: {}, devices: {} };
  vm.runInNewContext(source + `
    hint = new HintBar(el.hint);
    badge = new LayoutBadge(el.badge, layoutsFor(state.intent), onManualPick);
    overlay = { clear() {}, draw(layout, opts) { this.latest = { layout, opts }; } };
    planner = { planPaused: false, invalidate() { this.planPaused = false; },
      setPlanPaused(value) { this.planPaused = value; } };
    globalThis.harness = { state, el, stabilizer, badge, planner, overlay,
      onPlan, onCustom, onLight, getPlanContext, startAnalysis, resumeForView,
      onIntentChange, onManualPick };
  `, sandbox);
  return sandbox.harness;
}

const plan = (extra = {}) => ({layout: "rule_thirds", fit: "adjust",
  adjust: {mirror: true, flip_y: true, scale: 1, shift_x: 0, shift_y: .02},
  alignment: "move", action: "move_left", advice: "杯標往左，靠近右下交點",
  placements: [{slot: "main", item: "飲料杯", feature: "杯標中心"}], remove: [], ...extra});
const ready = () => plan({alignment: "ready", action: "none", advice: ""});
const lock = (a) => { a.onPlan(plan()); a.onPlan(plan()); };

test("actual UI freezes all geometry and subject features through repeated LLM changes", () => {
  const a = app(); lock(a);
  const fixed = JSON.stringify(a.state.layout);
  for (let i = 0; i < 5; i++) a.onPlan(plan({layout: "diagonal", adjust: {mirror: false, shift_y: -.08},
    placements: [{slot: "main", item: "另一個名字", feature: "杯蓋"}]}));
  assert.equal(JSON.stringify(a.state.layout), fixed);
  assert.equal(a.state.features.main, "杯標中心");
  assert.equal(a.getPlanContext().current.slots.find(s => s.id === "main").feature, "杯標中心");
  assert.equal(a.getPlanContext().phase, "guiding");
});

test("actual UI announces ready, marks shutter, freezes light advice and keeps shutter usable", () => {
  const a = app(); lock(a);
  a.onPlan(ready());
  assert.match(a.el.hint.textContent, /保持一下/);
  a.onPlan(ready());
  assert.equal(a.el.hint.textContent, "構圖完成，可以拍攝");
  assert.equal(a.el.shutter.dataset.ready, "true");
  assert.equal(a.el.shutter.disabled, false);
  assert.equal(a.planner.planPaused, true);
  assert.equal(a.overlay.latest.opts.aligned.main, true);
  a.onLight({verdict: "stylish", tip: "再往低一點拍"});
  assert.doesNotMatch(a.el.light.textContent, /往低/);
  assert.equal(a.state.light, null);
});

test("view change only rechecks target; reanalysis unlocks and clears subjects", () => {
  const a = app(); lock(a); a.onPlan(ready()); a.onPlan(ready());
  const fixed = JSON.stringify(a.state.layout), session = a.stabilizer.sessionId;
  a.resumeForView();
  assert.equal(a.stabilizer.phase, "guiding");
  assert.equal(JSON.stringify(a.state.layout), fixed);
  assert.equal(a.planner.planPaused, false);
  assert.ok(a.stabilizer.sessionId > session);
  a.startAnalysis();
  assert.equal(a.stabilizer.phase, "searching");
  assert.equal(a.badge.locked, false);
  assert.equal(Object.keys(a.state.items).length, 0);
});

test("manual layouts are immediately fixed and are not discarded on subject loss", () => {
  const a = app();
  a.badge.locked = true;
  a.onManualPick(getLayout("diagonal"));
  const fixed = JSON.stringify(a.state.layout);
  a.onPlan(plan()); a.onPlan(plan());
  assert.equal(JSON.stringify(a.state.layout), fixed);
  a.onPlan(plan({alignment: "lost", placements: []}));
  a.onPlan(plan({alignment: "lost", placements: []}));
  assert.equal(a.state.layout.id, "diagonal");
  assert.equal(a.stabilizer.phase, "guiding");
});

test("custom generation requires candidate consensus, happens once, failure releases waiting", () => {
  const a = app();
  assert.equal(a.onPlan(plan({needs_custom: true})), false);
  assert.equal(a.onPlan(plan({needs_custom: true})), true);
  a.onCustom(null);
  assert.equal(a.state.awaitingCustom, false);
  assert.equal(a.stabilizer.phase, "guiding");
  assert.equal(a.onPlan(plan({needs_custom: true})), false);
  a.startAnalysis();
  a.onPlan(plan({needs_custom: true})); a.onPlan(plan({needs_custom: true}));
  a.onCustom({custom: {name: "杯子構圖", slots: [{id: "cup", prefer: "hero", box: [.1,.2,.7,.7]}]},
    placements: [{slot: "cup", item: "飲料杯"}]});
  assert.equal(a.state.layout.dynamic, true);
  const fixed = JSON.stringify(a.state.layout);
  a.onCustom({custom: {name: "不應套用", slots: [{id: "x", box: [.2,.3,.5,.6]}]}});
  assert.equal(JSON.stringify(a.state.layout), fixed);
});

test("portrait intent restarts analysis and keeps its own layout catalog", () => {
  const a = app(); lock(a);
  a.onIntentChange(INTENTS.find(i => i.id === "portrait"));
  assert.equal(a.stabilizer.phase, "searching");
  assert.equal(a.getPlanContext().intent, "portrait");
  assert.ok(a.getPlanContext().layouts.includes("portrait_environment"));
});
