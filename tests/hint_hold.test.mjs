import test from "node:test";
import assert from "node:assert/strict";
import { HintBar } from "../web/js/ui/hintBar.js";

function fixture(t) {
  let now = 0;
  t.mock.timers.enable({apis: ["setTimeout"]});
  t.mock.method(performance, "now", () => now);
  const el = {textContent: "", dataset: {}, style: {}};
  const bar = new HintBar(el);
  return {bar, el, advance(ms) { now += ms; t.mock.timers.tick(ms); }};
}

test("clear guidance stays five seconds and only the latest pending instruction appears", t => {
  const {bar, el, advance} = fixture(t);
  bar.set("往左一點", "info", {holdMs: 5000});
  advance(1000); bar.set("正在確認…");
  advance(1000); bar.set("再靠近一點", "info", {holdMs: 5000});
  advance(2999); assert.equal(el.textContent, "往左一點");
  advance(1); assert.equal(el.textContent, "再靠近一點");
  advance(1000); bar.set("新的提示");
  advance(3999); assert.equal(el.textContent, "再靠近一點");
  advance(1); assert.equal(el.textContent, "新的提示");
});

test("repeated model wording never extends the hold or revives a superseded message", t => {
  const {bar, el, advance} = fixture(t);
  bar.set("往左", "info", {holdMs: 3000});
  advance(1000); bar.set("往右", "info", {holdMs: 3000});
  advance(1000); bar.set("往左", "info", {holdMs: 3000});
  advance(1000); assert.equal(el.textContent, "往左");
  bar.set("保持位置");
  assert.equal(el.textContent, "保持位置");
});

test("arrival, lost subject and reset bypass the reading hold and cancel pending advice", t => {
  const {bar, el, advance} = fixture(t);
  bar.set("往左", "info", {holdMs: 3000});
  bar.set("往右", "info", {holdMs: 3000});
  advance(500); bar.set("已接近目標，保持一下", "info", {immediate: true});
  advance(3000); assert.equal(el.textContent, "已接近目標，保持一下");
  bar.set("移近", "info", {holdMs: 3000});
  bar.set("移遠"); bar.clear();
  advance(4000); assert.equal(el.textContent, "");
});
