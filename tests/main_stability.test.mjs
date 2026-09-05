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
import { ExposureGuard } from "../web/js/vision/exposureGuard.js";
import { UI, applyUiConfig } from "../web/js/lib/config.js";

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
    performance, setTimeout, clearTimeout, clearInterval, setInterval, ExposureGuard,
    PlanStabilizer, PLAN_PHASE, LayoutBadge, HintBar, INTENTS, DEFAULT_INTENT,
    ALL, getLayout, layoutsFor, applyAdjust, toLayout, LIGHT_TEXT, CONFIG,
    resetSceneMemory() {}, camera: {}, devices: {},
    UI, applyUiConfig,
    // main.js 啟動時會抓 /api/ui-config，測試環境沒有後端，
    // 給一個必定失敗的 stub 讓它退回預設值即可。
    fetch: () => Promise.reject(new Error("no server in tests")) };
  vm.runInNewContext(source + `
    hint = new HintBar(el.hint);
    badge = new LayoutBadge(el.badge, layoutsFor(state.intent), onManualPick);
    overlay = { clear() {}, draw(layout, opts) { this.latest = { layout, opts }; } };
    planner = { planPaused: false, invalidate() { this.planPaused = false; }, resetLighting() {},
      setPlanPaused(value) { this.planPaused = value; } };
    globalThis.harness = { state, el, stabilizer, badge, planner, overlay, hint,
      onPlan, onCustom, onLight, getPlanContext, startAnalysis, resumeForView,
      onIntentChange, onManualPick, updateAnalysisStatus, onPlanDeferred, onExposure };
  `, sandbox);
  return sandbox.harness;
}

const plan = (extra = {}) => ({layout: "rule_thirds", fit: "adjust",
  adjust: {mirror: true, flip_y: true, scale: 1, shift_x: 0, shift_y: .02},
  alignment: "move", action: "move_left", advice: "杯標往左，靠近右下交點",
  placements: [{slot: "main", item: "飲料杯", feature: "杯標中心"}], remove: [], ...extra});
const ready = () => plan({alignment: "ready", action: "none", advice: ""});
const lock = (a) => {
  a.onLight({verdict: "good", source: "left", issue: "none", fill_from: "none", tip: ""});
  a.onPlan(plan()); a.onPlan(plan());
};

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

test("actual UI announces ready with checked lighting and preserves useful light advice", () => {
  const a = app(); lock(a);
  a.onPlan(ready());
  assert.match(a.el.hint.textContent, /保持一下/);
  a.onPlan(ready());
  assert.equal(a.el.hint.textContent, "構圖完成，可以拍攝");
  assert.equal(a.el.shutter.dataset.ready, "true");
  assert.equal(a.el.shutter.disabled, false);
  assert.equal(a.planner.planPaused, true);
  assert.equal(a.overlay.latest.opts.aligned.main, true);
  a.onLight({verdict: "stylish", tip: "可用白紙在暗側反光，保留暖黃氛圍"});
  assert.match(a.el.light.textContent, /白紙在暗側反光/);
  assert.equal(a.state.light.verdict, "stylish");
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

test("activity distinguishes scanning from a real model response or failure", () => {
  const a = app();
  const activity = {running: true, paused: false, activeKind: null,
    outcome: "waiting", lastPlanResultAt: null};
  a.updateAnalysisStatus(activity);
  assert.match(a.el.analysis.textContent, /等待首次判斷/);
  a.updateAnalysisStatus({...activity, activeKind: "plan", outcome: "analyzing"});
  assert.match(a.el.analysis.textContent, /正在判斷/);
  a.updateAnalysisStatus({...activity, outcome: "updated", lastPlanResponseAt: performance.now()});
  assert.match(a.el.analysis.textContent, /回覆/);
  a.updateAnalysisStatus({...activity, outcome: "error"});
  assert.match(a.el.analysis.textContent, /暫無回應/);
  a.updateAnalysisStatus({...activity, outcome: "moving", viewPending: true});
  assert.match(a.el.analysis.textContent, /確認新位置/);
});

test("new response time does not pretend that a stale frame has been applied", () => {
  const a = app(); lock(a);
  a.updateAnalysisStatus({running: true, outcome: "moving", viewPending: true,
    activeKind: "plan", lastPlanResponseAt: performance.now(), lastPlanResultAt: performance.now() - 10000});
  assert.match(a.el.analysis.textContent, /確認新位置/);
  assert.doesNotMatch(a.el.analysis.textContent, /10\.0 秒前/);
  a.onPlanDeferred({reason: "expired"});
  assert.match(a.el.hint.textContent, /確認最新畫面/);
  assert.doesNotMatch(a.el.hint.textContent, /往左/);
});

test("motion clears ready and old instructions immediately, without unlocking geometry", () => {
  const a = app(); lock(a);
  a.onPlan(ready()); a.onPlan(ready());
  const geometry = JSON.stringify(a.state.layout), session = a.stabilizer.sessionId;
  a.onPlanDeferred({reason: "moving"});
  assert.equal(a.stabilizer.phase, "guiding");
  assert.equal(a.el.shutter.dataset.ready, "false");
  assert.equal(a.stabilizer.sessionId, session);
  assert.equal(JSON.stringify(a.state.layout), geometry);
  a.onPlan(ready());
  assert.equal(a.stabilizer.phase, "guiding");
  a.onPlan(ready());
  assert.equal(a.stabilizer.phase, "ready");
});

test("HTTP 200 fallback is shown as unfinished analysis, not a new valid judgment", () => {
  const a = app();
  a.updateAnalysisStatus({running: true, outcome: "error", lastPlanResponseAt: performance.now(), responseMeta: {fallback: true}});
  assert.match(a.el.analysis.textContent, /分析未完成/);
});

test("expired directions are removed immediately while waiting for a new confirmed direction", () => {
  const a = app(); lock(a);
  const geometry = JSON.stringify(a.state.layout);
  a.onPlanDeferred({reason: "expired"});
  const correction = plan({action: "move_right", advice: "再往右一點"});
  a.onPlan(correction);
  assert.equal(a.state.progress, "guidance_pending");
  assert.match(a.el.hint.textContent, /先保持目前位置/);
  assert.doesNotMatch(a.el.hint.textContent, /往左/);
  a.onPlan(correction);
  assert.equal(a.el.hint.textContent, "再往右一點");
  assert.equal(JSON.stringify(a.state.layout), geometry);
});

/**
 * v0.33 的行為是「光線還沒回來就不算 ready」。
 *
 * 但 v0.32 起光線改成只在首次或明顯變化時才呼叫，
 * 最短間隔 15 秒。結果構圖明明對好了，快門卻一直不變綠，
 * 狀態列永遠停在「確認光線中」。
 *
 * 光線是輔助資訊，不該是構圖完成的前提。
 * 只有「明確判定有問題」才擋，未知一律視為可拍。
 */
test("光線未知不該擋住可拍攝", () => {
  const a = app(); a.onPlan(plan()); a.onPlan(plan());
  a.onPlan(ready()); a.onPlan(ready());
  assert.equal(a.stabilizer.phase, "ready");
  assert.equal(a.el.shutter.dataset.ready, "true", "光線還沒回來也要能拍");
  assert.equal(a.el.shutter.disabled, false);
  assert.match(a.el.status.textContent, /可以拍攝/);
  // 光線之後回來說沒問題，狀態不該倒退
  a.onLight({verdict: "good", source: "left"});
  assert.equal(a.el.shutter.dataset.ready, "true");
});

test("READY retains exact fill advice and fixed geometry, then recovers when light improves", () => {
  const a = app(); lock(a); a.onPlan(ready()); a.onPlan(ready());
  const geometry = JSON.stringify(a.state.layout), session = a.stabilizer.sessionId;
  a.onLight({verdict: "problem", issue: "too_dark", fill_from: "front",
    tip: "保留藍紫背景，從正面加一點柔光照亮杯身"});
  assert.match(a.el.light.textContent, /正面加一點柔光/);
  assert.match(a.el.status.textContent, /建議先補光/);
  assert.equal(a.el.shutter.dataset.ready, "false");
  assert.equal(a.el.shutter.disabled, false);
  assert.equal(JSON.stringify(a.state.layout), geometry);
  assert.equal(a.stabilizer.sessionId, session);
  a.onLight({verdict: "stylish", mood: "藍紫光", tip: "可讓光從側面照杯身"});
  assert.equal(a.el.shutter.dataset.ready, "true");
  assert.match(a.el.light.textContent, /從側面照杯身/);
});

test("sustained local darkness overrides a model good verdict; a single flash does not", () => {
  const a = app(); lock(a); a.onPlan(ready()); a.onPlan(ready());
  const dark = {mean: .12, subject: .15, subject_ratio: 1};
  const bright = {mean: .4, subject: .4, subject_ratio: 1};
  a.onExposure(dark);
  assert.equal(a.el.shutter.dataset.ready, "true");
  a.onExposure(bright);
  a.onExposure(dark); a.onExposure(dark);
  assert.equal(a.el.shutter.dataset.ready, "false");
  assert.match(a.el.light.textContent, /畫面偏暗.*補柔光/);
  a.onLight({verdict: "good"});
  assert.equal(a.el.shutter.dataset.ready, "false");
  a.onExposure(bright); a.onExposure(bright);
  assert.equal(a.el.shutter.dataset.ready, "true");
});
