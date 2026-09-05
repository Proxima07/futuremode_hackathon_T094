import test from "node:test";
import assert from "node:assert/strict";
import {LightChangeMonitor} from "../web/js/vision/lightChangeMonitor.js";

const exposure = {mean: .5, clipped_high: .01, clipped_low: .01, warmth: 0,
  saturation: .3, dominant_hue: 90, color_ratio: .4, left: .5, right: .5, top: .5, bottom: .5};
const observe3 = (m, e) => { for (let i = 0; i < 3; i++) m.observe(e); };

test("initial analysis waits for stable observations; unchanged light never refreshes on a timer", () => {
  const m = new LightChangeMonitor();
  m.observe(exposure); m.observe(exposure);
  assert.equal(m.shouldAnalyze(2000), false);
  m.observe(exposure);
  assert.equal(m.shouldAnalyze(3000), true);
  m.accept(exposure, 3000);
  for (let i = 0; i < 300; i++) m.observe(exposure);
  assert.equal(m.shouldAnalyze(300000), false);
});

test("brightness, color and direction changes can independently trigger an analysis", () => {
  for (const patch of [{mean: .65}, {mean: .3}, {warmth: .3}, {dominant_hue: 240}, {left: .8}, {clipped_high: .4}]) {
    const m = new LightChangeMonitor(); m.accept(exposure, 0);
    observe3(m, {...exposure, ...patch});
    assert.equal(m.shouldAnalyze(20000), true, JSON.stringify(patch));
  }
});

test("a flash, small drift, or unstable moving view does not trigger light inference", () => {
  const m = new LightChangeMonitor(); m.accept(exposure, 0);
  m.observe({...exposure, mean: .8});
  observe3(m, exposure);
  assert.equal(m.shouldAnalyze(20000), false);
  observe3(m, {...exposure, mean: .52, warmth: .03});
  assert.equal(m.shouldAnalyze(20000), false);
  for (let i = 0; i < 4; i++) m.observe({...exposure, mean: .8}, {stable: false});
  assert.equal(m.shouldAnalyze(20000), false);
});

test("cooldown limits repeated light changes, and failure does not accept a new baseline", () => {
  const m = new LightChangeMonitor(); m.accept(exposure, 0);
  const dark = {...exposure, mean: .2};
  observe3(m, dark);
  assert.equal(m.shouldAnalyze(5000), false);
  assert.equal(m.shouldAnalyze(15000), true);
  m.fail(15000);
  assert.deepEqual(m.baseline, exposure);
  assert.equal(m.shouldAnalyze(20000), false);
  assert.equal(m.shouldAnalyze(30000), true);
  m.accept(dark, 30000); observe3(m, dark);
  assert.equal(m.shouldAnalyze(60000), false);
});

test("returning to the old light before analysis cancels the pending event", () => {
  const m = new LightChangeMonitor(); m.accept(exposure, 0);
  observe3(m, {...exposure, mean: .2});
  m.observe(exposure);
  assert.equal(m.shouldAnalyze(20000), false);
});
