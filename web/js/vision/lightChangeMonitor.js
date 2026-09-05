/** 本機曝光統計觸發器。靜態光線不會因時間到了就再呼叫 VLM。 */
const DEFAULTS = {
  confirmations: 3, minIntervalMs: 15000,
  meanDelta: .10, subjectDelta: .12, colorDelta: .16, directionDelta: .14, clipDelta: .12,
};

export function lightingChange(a, b, options = DEFAULTS) {
  if (!a || !b) return "initial";
  const o = { ...DEFAULTS, ...options };
  const delta = (key) => (b[key] ?? 0) - (a[key] ?? 0);
  if (Math.abs(delta("mean")) >= o.meanDelta) return delta("mean") > 0 ? "brighter" : "darker";
  if (Math.abs(delta("clipped_high")) >= o.clipDelta || Math.abs(delta("clipped_low")) >= o.clipDelta) return "clipping";
  if (Number.isFinite(a.subject) && Number.isFinite(b.subject) && Math.abs(delta("subject")) >= o.subjectDelta) return "subject";
  if (Math.abs(delta("warmth")) >= o.colorDelta || Math.abs(delta("saturation")) >= o.colorDelta) return "color";
  if (a.color_ratio > .2 && b.color_ratio > .2 && a.dominant_hue >= 0 && b.dominant_hue >= 0) {
    const hue = Math.abs(a.dominant_hue - b.dominant_hue);
    if (Math.min(hue, 360 - hue) >= 45) return "color";
  }
  const direction = (e) => [(e.left ?? 0) - (e.right ?? 0), (e.top ?? 0) - (e.bottom ?? 0)];
  const da = direction(a), db = direction(b);
  if (da.some((v, i) => Math.abs(v - db[i]) >= o.directionDelta)) return "direction";
  return "";
}

export class LightChangeMonitor {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.baseline = null;
    this.latest = null;
    this.previous = null;
    this.reason = "";
    this.count = 0;
    this.pending = false;
    this.retryAt = 0;
    this.failures = 0;
  }

  observe(exposure, { stable = true } = {}) {
    if (!exposure || !Number.isFinite(exposure.mean)) return;
    this.latest = { ...exposure };
    const reason = lightingChange(this.baseline, exposure, this.options);
    const changedAgain = this.previous && lightingChange(this.previous, exposure, this.options);
    if (!stable || !reason) {
      this.count = 0; this.reason = ""; this.pending = false;
    } else {
      this.count = reason === this.reason && !changedAgain ? this.count + 1 : 1;
      this.reason = reason;
      this.pending = this.count >= this.options.confirmations;
    }
    this.previous = { ...exposure };
  }

  shouldAnalyze(now) { return this.pending && now >= this.retryAt; }

  accept(exposure, now) {
    this.baseline = { ...exposure };
    this.count = 0; this.reason = ""; this.pending = false;
    this.failures = 0;
    this.retryAt = now + this.options.minIntervalMs;
  }

  fail(now) {
    this.failures++;
    this.retryAt = now + Math.min(60000, this.options.minIntervalMs * 2 ** (this.failures - 1));
  }
}
