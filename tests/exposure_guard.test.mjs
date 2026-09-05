import test from "node:test";
import assert from "node:assert/strict";
import { ExposureGuard } from "../web/js/vision/exposureGuard.js";

const dark = {mean: .12, subject: .16, subject_ratio: 1};
const bright = {mean: .45, subject: .48, subject_ratio: 1.1};

test("darkness and recovery both require sustained evidence", () => {
  const g = new ExposureGuard();
  assert.equal(g.observe(dark), "");
  assert.equal(g.observe(dark), "too_dark");
  assert.equal(g.observe(bright), "too_dark");
  assert.equal(g.observe(bright), "");
});

test("a readable subject on a dark background is not flagged; a dark backlit subject is", () => {
  const g = new ExposureGuard();
  const darkBackground = {mean: .15, subject: .5, subject_ratio: 3.3};
  g.observe(darkBackground); assert.equal(g.observe(darkBackground), "");
  const backlit = {mean: .4, subject: .18, subject_ratio: .4};
  g.observe(backlit); assert.equal(g.observe(backlit), "backlit");
});

test("movement, missing subject, and incomplete measurements do not create false warnings", () => {
  const g = new ExposureGuard();
  g.observe(dark, {stable: false}); assert.equal(g.observe(dark, {stable: false}), "");
  g.observe(dark); assert.equal(g.observe(dark, {hasSubject: false}), "");
  g.observe(null); assert.equal(g.observe({mean: .1}), "");
  assert.equal(g.observe(dark), "");
});

test("small exposure fluctuations around the threshold do not flash the warning", () => {
  const g = new ExposureGuard();
  g.observe(dark); g.observe(dark);
  for (const mean of [.199, .21, .198, .22]) {
    assert.equal(g.observe({...dark, mean}), "too_dark");
  }
  g.observe(bright); assert.equal(g.observe(bright), "");
});
