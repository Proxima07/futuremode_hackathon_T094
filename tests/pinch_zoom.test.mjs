/** 兩指縮放：只保留最新目標值，避免慢的舊請求把倍率倒退回去。 */
import test from "node:test";
import assert from "node:assert/strict";
import { PinchZoom } from "../web/js/ui/pinchZoom.js";

function surface() {
  const handlers = {};
  return {
    handlers,
    addEventListener(name, fn) { handlers[name] = fn; },
    fire(name, payload) { handlers[name]?.(payload); },
  };
}
function readout() {
  return { textContent: "", classList: { add() {}, remove() {} } };
}
function touches(distance) {
  return [{ clientX: 0, clientY: 0 }, { clientX: distance, clientY: 0 }];
}
const ev = (list) => ({ touches: list, preventDefault() {} });

test("兩指張開會放大，收合會縮小", async () => {
  const applied = [];
  const s = surface();
  const z = new PinchZoom(s, readout(), async (v) => {
    applied.push(v); return { supported: true, min: 1, max: 8, step: .1, current: v };
  });
  z.configure({ supported: true, min: 1, max: 8, step: .1, current: 1 });

  s.fire("touchstart", ev(touches(100)));
  s.fire("touchmove", ev(touches(200)));   // 距離兩倍 → 倍率兩倍
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(applied.at(-1), 2);

  s.fire("touchmove", ev(touches(50)));    // 距離一半 → 倍率 0.5，但下限是 1
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(applied.at(-1), 1);
  s.fire("touchend");
});

test("倍率被夾在鏡頭能力範圍內", async () => {
  const applied = [];
  const s = surface();
  const z = new PinchZoom(s, readout(), async (v) => {
    applied.push(v); return { supported: true, min: 1, max: 3, step: .1, current: v };
  });
  z.configure({ supported: true, min: 1, max: 3, step: .1, current: 1 });
  s.fire("touchstart", ev(touches(50)));
  s.fire("touchmove", ev(touches(5000)));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(applied.at(-1), 3, "不能超過鏡頭上限");
});

test("不支援縮放時手勢完全不觸發", async () => {
  let called = 0;
  const s = surface();
  const z = new PinchZoom(s, readout(), async () => { called++; return null; });
  z.configure({ supported: false });
  s.fire("touchstart", ev(touches(100)));
  s.fire("touchmove", ev(touches(300)));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(called, 0);
  assert.equal(z.supported, false);
});

test("單指不觸發縮放", async () => {
  let called = 0;
  const s = surface();
  const z = new PinchZoom(s, readout(), async () => { called++; return null; });
  z.configure({ supported: true, min: 1, max: 5, step: .1, current: 1 });
  s.fire("touchstart", ev([{ clientX: 0, clientY: 0 }]));
  s.fire("touchmove", ev([{ clientX: 80, clientY: 0 }]));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(called, 0);
});

test("套用中不會塞車，只保留最新目標", async () => {
  const applied = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = surface();
  const z = new PinchZoom(s, readout(), async (v) => {
    applied.push(v);
    if (applied.length === 1) await gate;
    return { supported: true, min: 1, max: 8, step: .1, current: v };
  });
  z.configure({ supported: true, min: 1, max: 8, step: .1, current: 1 });

  s.fire("touchstart", ev(touches(100)));
  s.fire("touchmove", ev(touches(150)));   // 1.5
  s.fire("touchmove", ev(touches(200)));   // 2.0
  s.fire("touchmove", ev(touches(300)));   // 3.0
  release();
  await new Promise((r) => setTimeout(r, 10));

  // 中間的 2.0 應該被丟掉，只送首筆與最新的
  assert.deepEqual(applied, [1.5, 3]);
});
