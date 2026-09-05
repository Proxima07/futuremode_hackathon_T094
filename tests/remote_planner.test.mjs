import test from "node:test";
import assert from "node:assert/strict";

let pattern = 0;
const visibilityListeners = [];
const draws = [];
globalThis.document = {
  hidden: false, addEventListener(_event, fn) { visibilityListeners.push(fn); },
  createElement() {
    return { width: 32, height: 32,
      toDataURL: () => `data:image/jpeg;base64,${pattern ? "bmV3" : "b2xk"}`,
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

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function clock(t) {
  let now = 0;
  t.mock.timers.enable({apis: ["setTimeout"]});
  t.mock.method(performance, "now", () => now);
  return {
    async advance(ms) {
      for (let remaining = ms; remaining > 0;) {
        const step = Math.min(50, remaining);
        now += step; remaining -= step;
        t.mock.timers.tick(step);
        await flush();
      }
    },
  };
}

function fakeNetwork(delay = 400) {
  const calls = [];
  let active = 0, peak = 0;
  globalThis.fetch = (url, opts) => {
    active++; peak = Math.max(peak, active);
    calls.push({url, at: performance.now(), body: JSON.parse(opts.body)});
    return new Promise((resolve) => {
      setTimeout(() => { active--; resolve(response()); }, typeof delay === "function" ? delay(url) : delay);
    });
  };
  return {calls, get peak() { return peak; }, plans: () => calls.filter(c => c.url === "/api/plan")};
}

test("400ms inference starts at 0/1000/2000ms, instead of sleeping after responses", async (t) => {
  const time = clock(t), network = fakeNetwork(400);
  const updates = [];
  const p = new RemotePlanner(video, () => ({}), {onPlan: () => { updates.push(performance.now()); }});
  p.start(); await time.advance(2900); p.stop();
  assert.deepEqual(network.plans().map(c => c.at), [0, 1000, 2000]);
  assert.deepEqual(updates, [400, 1400, 2400]);
  assert.equal(p.stats.scan, 3);
  assert.equal(network.peak, 1);
});

test("READY continues model review every second without moving the fixed target", async (t) => {
  const time = clock(t), network = fakeNetwork(400);
  const p = new RemotePlanner(video, () => ({phase: "guiding", current: {id: "rule_thirds"}}), {});
  p.setPlanPaused(true); p.lastLightSent = -100000;
  p.start(); await time.advance(2900); p.stop();
  assert.deepEqual(network.plans().map(c => c.at), [0, 1000, 2000]);
  assert.ok(network.plans().every(c => c.body.phase === "guiding"));
  assert.equal(network.calls.filter(c => c.url === "/api/light").length, 0);
});

test("slow inference never queues old frames; local scans continue and latest frame goes next", async (t) => {
  pattern = 0;
  const time = clock(t), network = fakeNetwork(1800);
  const p = new RemotePlanner(video, () => ({}), {});
  p.start(); await time.advance(1000);
  pattern = 1;
  await time.advance(2500); p.stop();
  assert.equal(network.peak, 1);
  assert.equal(network.plans().length, 2);
  assert.ok(network.plans()[1].at >= 1800 && network.plans()[1].at <= 1900);
  assert.equal(network.plans()[0].body.image, "b2xk");
  assert.equal(network.plans()[1].body.image, "bmV3");
  assert.equal(p.stats.scan, 4);
  assert.ok(p.stats.skip >= 1);
  pattern = 0;
});

test("READY motion detection works while a remote request is still running", async (t) => {
  pattern = 0;
  const time = clock(t); fakeNetwork(5000);
  let changed = 0;
  const p = new RemotePlanner(video, () => ({}), {onViewChanged: () => {changed++; p.setPlanPaused(false);}});
  p.setPlanPaused(true); p.start();
  await time.advance(500); pattern = 1;
  await time.advance(1600);
  assert.equal(changed, 1);
  assert.equal(p.busy, true);
  p.stop(); pattern = 0;
});

test("confirmation gets priority over overdue light; light still uses free time", async (t) => {
  const time = clock(t), network = fakeNetwork(100);
  let confirming = true;
  const p = new RemotePlanner(video, () => ({confirming}), {});
  p.lastLightSent = -100000; p.plansSinceLight = 4;
  p.start(); await time.advance(900);
  assert.deepEqual(network.calls.map(c => c.url), ["/api/plan"]);
  confirming = false;
  await time.advance(200); p.stop();
  assert.ok(network.calls.some(c => c.url === "/api/light"));
});

test("unexpectedly slow light does not add another idle delay before next plan", async (t) => {
  const time = clock(t), network = fakeNetwork(url => url === "/api/light" ? 1600 : 200);
  const p = new RemotePlanner(video, () => ({}), {});
  p.lastLightSent = -10000;
  p.start(); await time.advance(2300); p.stop();
  const light = network.calls.find(c => c.url === "/api/light");
  const nextPlan = network.plans()[1];
  assert.ok(nextPlan.at - (light.at + 1600) <= 50);
  assert.equal(network.peak, 1);
});

test("light failures do not back off the composition interval", async () => {
  const p = new RemotePlanner(video, () => ({}), {});
  await p._send(async () => null, {}, "light");
  await p._send(async () => null, {}, "light");
  assert.equal(p.interval, 1000);
  assert.equal(p.failuresByKind.light, 2);
});

test("plan failures visibly retry with backoff while sampling stays once per second", async (t) => {
  const time = clock(t), calls = [];
  globalThis.fetch = async () => { calls.push(performance.now()); return response({fallback: true}); };
  const p = new RemotePlanner(video, () => ({confirming: true}), {});
  p.start(); await flush(); await time.advance(5900); p.stop();
  assert.deepEqual(calls, [0, 2000]);
  assert.equal(p.planOutcome, "error");
  assert.equal(p.stats.scan, 6);
});

test("stop/start cannot revive the old loop or apply an aborted response", async (t) => {
  const time = clock(t), network = fakeNetwork(400), updates = [];
  const p = new RemotePlanner(video, () => ({}), {onPlan: () => { updates.push(performance.now()); }});
  p.start(); await time.advance(100); p.stop(); p.start();
  await time.advance(1500); p.stop();
  assert.ok(updates.every(at => at > 400));
  assert.equal(network.peak, 1);
  assert.equal(network.plans().length, 3);
});

test("hidden tab pauses capture and resumes with the latest scene", async (t) => {
  const time = clock(t), network = fakeNetwork(200);
  let resumed = 0;
  const p = new RemotePlanner(video, () => ({}), {onViewChanged: () => {resumed++; p.invalidate();}});
  const onVisibility = visibilityListeners.at(-1);
  p.start(); await time.advance(300);
  document.hidden = true; onVisibility();
  const scans = p.stats.scan;
  await time.advance(2200);
  assert.equal(network.plans().length, 1);
  assert.equal(p.stats.scan, scans);
  document.hidden = false; onVisibility();
  await time.advance(300); p.stop();
  assert.equal(resumed, 1);
  assert.equal(network.plans().length, 2);
});
