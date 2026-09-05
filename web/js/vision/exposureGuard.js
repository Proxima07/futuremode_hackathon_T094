/** 本機亮度提醒；補足模型漏看偏暗的情況，不判定物件材質或藝術風格。 */
const DEFAULTS = {
  confirmations: 2, recoveryConfirmations: 2,
  darkMean: .20, darkSubject: .26, backlitSubject: .28, backlitRatio: .55,
  recoveryMargin: .04,
};

export class ExposureGuard {
  constructor(options = {}) {
    this.options = {...DEFAULTS, ...options};
    this.reset();
  }

  reset() { this.issue = ""; this.candidate = ""; this.count = 0; }

  observe(e, {stable = true, hasSubject = true} = {}) {
    if (!hasSubject) { this.reset(); return this.issue; }
    if (!stable || !Number.isFinite(e?.mean) || !Number.isFinite(e?.subject)) {
      this.count = 0;
      return this.issue;
    }
    const o = this.options;
    const margin = this.issue ? o.recoveryMargin : 0;
    let candidate = "";
    if (e.subject < o.backlitSubject + margin && Number.isFinite(e.subject_ratio) &&
        e.subject_ratio < o.backlitRatio + margin) candidate = "backlit";
    else if (e.mean < o.darkMean + margin && e.subject < o.darkSubject + margin) candidate = "too_dark";

    if (candidate === this.issue) { this.count = 0; this.candidate = candidate; return this.issue; }
    this.count = candidate === this.candidate ? this.count + 1 : 1;
    this.candidate = candidate;
    const required = candidate ? o.confirmations : o.recoveryConfirmations;
    if (this.count >= required) { this.issue = candidate; this.count = 0; }
    return this.issue;
  }
}
