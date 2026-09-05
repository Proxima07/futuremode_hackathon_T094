import test from "node:test";
import assert from "node:assert/strict";

let pattern = 0;
const draws = [];
globalThis.document = {
  hidden: false, addEventListener() {},
  createElement() {
    return { width: 32, height: 32,
      toDataURL: () => "data:image/jpeg;base64,dGVzdA==",
      getContext: () => ({
        drawImage: (...args) => draws.push(args),
        getImageData: (_x, _y, w, h) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < data.length; i += 4) {
            const value = pattern ? (i % 8 ? 240 : 20) : 100;
            data.set([value, value, value, 255], i);
          }
          return { data };
        },
      }),
    };
  },
};
const { RemotePlanner } = await import("../web/js/planner/remotePlanner.js");
const { frameDifference, sampleFrame } = await import("../web/js/lib/api.js");
const video = { videoWidth: 1280, videoHeight: 960,
  clientWidth: 390, clientHeight: 780,
  getBoundingClientRect: () => ({ width: 390, height: 780 }) };
const result = { layout: "single", alignment: "ready", placements: [{slot: "main", item: "杯子"}], remove: [] };
const response = (data = result) => ({ ok: true, json: async () => data });

test("static frames still produce consecutive plan requests and custom needs explicit approval", async () => {
  const payloads = [];
  globalThis.fetch = async (_url, opts) => { payloads.push(JSON.parse(opts.body)); return response({...result, needs_custom: true}); };
  const p = new RemotePlanner(video, () => ({ phase: "guiding", sessionId: 1, lastAdvice: "杯標靠左" }), { onPlan: () => false });
  await p._runPlan(); await p._runPlan();
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].phase, "guiding");
  assert.equal(payloads[0].last_advice, "杯標靠左");
  assert.equal(p.needsCustom, false);
  p.on.onPlan = () => true;
  await p._runPlan();
  assert.equal(p.needsCustom, true);
});

test("plan, light and custom responses from old sessions are ignored", async () => {
  for (const method of ["_runPlan", "_runLight", "_runCustom"]) {
    let sessionId = 1, deliver, calls = 0;
    globalThis.fetch = () => new Promise((resolve) => { deliver = resolve; });
    const onResult = () => { calls++; };
    const p = new RemotePlanner(video, () => ({ sessionId }), {onPlan: onResult, onLight: onResult, onCustom: onResult});
    const pending = p[method]();
    sessionId = 2;
    deliver(response());
    await pending;
    assert.equal(calls, 0, method);
  }
});

test("READY from a photo captured before a large movement is discarded", async () => {
  pattern = 0;
  let deliver, calls = 0;
  globalThis.fetch = () => new Promise((resolve) => { deliver = resolve; });
  const p = new RemotePlanner(video, () => ({}), {onPlan: () => calls++});
  const pending = p._runPlan();
  pattern = 1;
  deliver(response()); await pending;
  assert.equal(calls, 0);
  assert.equal(p.stats.skip, 1);
  pattern = 0;
});

test("READY view monitoring waits for sustained change and never mutates layout", () => {
  pattern = 0;
  let calls = 0;
  const p = new RemotePlanner(video, () => ({}), {onViewChanged: () => calls++});
  p.setPlanPaused(true);
  p.readyAt = -10000;
  p._checkReadyView();
  assert.equal(calls, 0);
  pattern = 1;
  p._checkReadyView(); assert.equal(calls, 0);
  p._checkReadyView(); assert.equal(calls, 1);
  p.setPlanPaused(false);
  assert.equal(p.readyFrame, null);
  pattern = 0;
});

test("frame fingerprint uses preview crop and ignores a uniform exposure offset", () => {
  draws.length = 0;
  sampleFrame(video);
  const args = draws.at(-1);
  assert.equal(args.length, 9);
  assert.ok(args[1] > 0); // horizontal source crop on portrait display
  assert.ok(args[3] < video.videoWidth);
  assert.equal(frameDifference(new Uint8Array([10, 30]), new Uint8Array([30, 50])), 0);
});

test("request exceptions release busy; abort ignores late results", async () => {
  const p = new RemotePlanner(video, () => ({}), {});
  assert.equal(await p._send(async () => { throw new Error("test failure"); }, {}, "plan"), null);
  assert.equal(p.busy, false);
  let finish;
  const pending = p._send(() => new Promise((resolve) => { finish = resolve; }), {}, "plan");
  p.invalidate(); finish(result);
  assert.equal(await pending, null);
  assert.equal(p.busy, false);
});

test("stop/start does not revive the old scheduling loop", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const p = new RemotePlanner(video, () => ({}), {});
  p._runPlan = async () => { calls++; };
  p.lastLightSent = performance.now();
  p.start(); p.stop(); p.start();
  t.mock.timers.tick(701);
  await Promise.resolve(); await Promise.resolve();
  p.stop();
  assert.equal(calls, 1);
});

test("READY scheduler defers plans until its review interval and pauses light advice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let plans = 0, lights = 0;
  const p = new RemotePlanner(video, () => ({}), {});
  p._runPlan = async () => { plans++; p.lastPlanSent = performance.now(); };
  p._runLight = async () => { lights++; };
  p.setPlanPaused(true);
  p.lastPlanSent = performance.now();
  p.lastLightSent = -100000;
  p.start(); t.mock.timers.tick(701);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(plans, 0); assert.equal(lights, 0);
  p.lastPlanSent = -100000;
  t.mock.timers.tick(701);
  await Promise.resolve(); await Promise.resolve();
  p.stop();
  assert.equal(plans, 1); assert.equal(lights, 0);
});
