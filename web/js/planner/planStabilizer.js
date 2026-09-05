/**
 * 構圖決策穩定器。
 *
 * LLM 適合挑選構圖，不適合直接當每一幀都重算目標的伺服控制器。
 * 這個類別把流程拆成：
 *
 *   searching  收集候選，兩次方向一致才定案
 *   guiding    版型與座標固定，只接受移動建議／完成判斷
 *   ready      多幀確認完成，持續複查固定目標，不重新設計構圖
 *
 * 它不碰 DOM，也不呼叫 API，因此可以獨立測試。
 */

export const PLAN_PHASE = Object.freeze({
  SEARCHING: "searching",
  GUIDING: "guiding",
  READY: "ready",
});

const DEFAULTS = Object.freeze({
  planConfirmations: 2,
  maxPlanSamples: 3,
  readyVotes: 2,
  readyWindow: 3,
  lostConfirmations: 2,
  guidanceConfirmations: 2,
  evidenceMaxAgeMs: 10000,
  adviceRefreshMs: 2000,
});

const ACTIONS = new Set([
  "none", "move_left", "move_right", "move_up", "move_down",
  "move_closer", "move_farther", "rotate_clockwise",
  "rotate_counterclockwise", "reframe",
]);

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : fallback;
}

function normalizeAction(value) {
  return ACTIONS.has(value) ? value : "reframe";
}

/**
 * 候選只比較真正影響構圖種類與方向的部分。
 * scale/shift 即使有一點數值飄動，也不該讓系統永遠無法定案。
 */
export function planSignature(plan) {
  const layout = String(plan?.layout ?? "").trim();
  if (!layout) return "";
  const adjust = plan?.fit === "adjust" ? (plan.adjust ?? {}) : {};
  return [layout, !!adjust.mirror, !!adjust.flip_y, !!plan.needs_custom].join("|");
}

export class PlanStabilizer {
  constructor(options = {}) {
    this.options = {
      planConfirmations: positiveInt(
        options.planConfirmations, DEFAULTS.planConfirmations
      ),
      maxPlanSamples: positiveInt(
        options.maxPlanSamples, DEFAULTS.maxPlanSamples
      ),
      readyVotes: positiveInt(options.readyVotes, DEFAULTS.readyVotes),
      readyWindow: positiveInt(options.readyWindow, DEFAULTS.readyWindow),
      lostConfirmations: positiveInt(
        options.lostConfirmations, DEFAULTS.lostConfirmations
      ),
      guidanceConfirmations: positiveInt(
        options.guidanceConfirmations, DEFAULTS.guidanceConfirmations
      ),
      evidenceMaxAgeMs: positiveInt(options.evidenceMaxAgeMs, DEFAULTS.evidenceMaxAgeMs),
      adviceRefreshMs: positiveInt(options.adviceRefreshMs, DEFAULTS.adviceRefreshMs),
    };
    this.options.readyWindow = Math.max(this.options.readyVotes, this.options.readyWindow);
    this._sessionId = 0;
    this.reset();
  }

  get phase() { return this._phase; }
  get sessionId() { return this._sessionId; }
  get lastAction() { return this._acceptedAction ?? "none"; }
  get lockedPlan() { return this._lockedPlan; }

  get snapshot() {
    return {
      phase: this._phase,
      sessionId: this._sessionId,
      samples: this._sampleCount,
      lockedSignature: this._lockedSignature,
      readyHistory: [...this._readyHistory],
      lastAction: this.lastAction,
    };
  }

  /** 開始一段全新的構圖判斷，舊請求可用 sessionId 被忽略。 */
  reset() {
    this._sessionId++;
    this._phase = PLAN_PHASE.SEARCHING;
    this._candidates = new Map();
    this._sampleCount = 0;
    this._lockedPlan = null;
    this._lockedSignature = "";
    this._readyHistory = [];
    this._lostStreak = 0;
    this._acceptedAction = null;
    this._pendingAction = null;
    this._pendingActionCount = 0;
    this._acceptedCue = "";
    this._lastEvidenceAt = 0;
    this._reviewMisses = 0;
    this._acceptedAdvice = "";
    this._adviceAt = 0;
    return this.snapshot;
  }

  /** 使用者手選或動態版型生成時直接定案，不再等待候選投票。 */
  forceLock(plan = {}) {
    this.reset();
    this._lock(plan, planSignature(plan) || "manual");
    return { kind: "locked", phase: this._phase, plan, manual: true };
  }

  /** 視野改變後重驗，但不搬動已鎖定的構圖目標。 */
  resumeGuiding() {
    if (!this._lockedPlan) return this.reset();
    this._sessionId++;
    this._phase = PLAN_PHASE.GUIDING;
    this._readyHistory = [];
    this._lostStreak = 0;
    this._reviewMisses = 0;
    this._clearPending();
    this._lastEvidenceAt = 0;
    return this.snapshot;
  }

  ingest(plan, now = Date.now()) {
    if (!plan || typeof plan !== "object") {
      return { kind: "ignored", phase: this._phase };
    }
    const maxAge = this.options.evidenceMaxAgeMs;
    if (this._lastEvidenceAt && now - this._lastEvidenceAt > maxAge) {
      this._readyHistory = [];
      this._lostStreak = 0;
      this._reviewMisses = 0;
      this._clearPending();
      if (this._phase === PLAN_PHASE.SEARCHING) {
        this._candidates.clear();
        this._sampleCount = 0;
      }
    }
    this._lastEvidenceAt = now;
    if (this._phase === PLAN_PHASE.READY) return this._reviewReady(plan);
    return this._phase === PLAN_PHASE.SEARCHING
      ? this._ingestCandidate(plan)
      : this._ingestGuidance(plan, now);
  }

  _ingestCandidate(plan) {
    if (!plan.placements?.length || plan.alignment === "lost") {
      this._candidates.clear();
      this._sampleCount = 0;
      return { kind: "no_subject", phase: this._phase };
    }
    const signature = planSignature(plan);
    if (!signature) return { kind: "ignored", phase: this._phase };

    this._sampleCount++;
    const entry = this._candidates.get(signature) ?? {
      count: 0, plan, lastSample: 0,
    };
    entry.count++;
    entry.plan = plan;
    entry.lastSample = this._sampleCount;
    this._candidates.set(signature, entry);

    const confirmed = entry.count >= this.options.planConfirmations;
    const reachedLimit = this._sampleCount >= this.options.maxPlanSamples;

    if (confirmed || reachedLimit) {
      // 三次都不同時仍要收斂；選出現次數最多者，同票選最近一次。
      const winner = [...this._candidates.entries()]
        .sort((a, b) =>
          b[1].count - a[1].count || b[1].lastSample - a[1].lastSample
        )[0];
      this._lock(winner[1].plan, winner[0]);
      return {
        kind: "locked",
        phase: this._phase,
        plan: winner[1].plan,
        forced: !confirmed,
        samples: this._sampleCount,
      };
    }

    return {
      kind: "candidate",
      phase: this._phase,
      confirmations: entry.count,
      required: this.options.planConfirmations,
      samples: this._sampleCount,
    };
  }

  _lock(plan, signature) {
    this._phase = PLAN_PHASE.GUIDING;
    this._lockedPlan = plan;
    this._lockedSignature = signature;

    const action = normalizeAction(plan?.action);
    if (plan?.alignment === "move" && action !== "none") {
      this._acceptedAction = action;
      this._acceptedCue = this._cue(plan);
      this._acceptedAdvice = plan.advice ?? "";
      this._adviceAt = this._lastEvidenceAt;
    }
  }

  _clearPending() {
    this._pendingAction = null;
    this._pendingActionCount = 0;
  }

  _cue(plan) {
    // 方向相同但「要移除的東西」變了，也需要重新確認提示。
    return `${normalizeAction(plan.action)}|${(plan.remove ?? []).join("|")}`;
  }

  _reviewReady(plan) {
    if (plan.alignment === "ready" && plan.placements?.length && !plan.remove?.length) {
      this._reviewMisses = 0;
      this._lostStreak = 0;
      return { kind: "still_ready", phase: this._phase };
    }
    this._reviewMisses++;
    this._lostStreak = plan.alignment === "lost" || !plan.placements?.length
      ? this._lostStreak + 1 : 0;
    if (this._lostStreak >= this.options.lostConfirmations) {
      this.reset();
      return { kind: "replan", phase: this._phase };
    }
    if (this._reviewMisses >= this.options.guidanceConfirmations) {
      this.resumeGuiding();
      return { kind: "resumed", phase: this._phase };
    }
    return { kind: "review_pending", phase: this._phase };
  }

  _ingestGuidance(plan, now) {
    let alignment = ["move", "ready", "lost"].includes(plan.alignment)
      ? plan.alignment
      : "move";
    if (!plan.placements?.length) alignment = "lost";
    else if (alignment === "ready" && plan.remove?.length) alignment = "move";

    if (alignment === "lost") {
      this._lostStreak++;
      this._readyHistory = [];
      this._clearPending();
      if (this._lostStreak >= this.options.lostConfirmations) {
        this.reset();
        return { kind: "replan", phase: this._phase };
      }
      return { kind: "lost_pending", phase: this._phase };
    }

    this._lostStreak = 0;
    this._pushReady(alignment === "ready");

    if (alignment === "ready") {
      this._clearPending();
      const readyCount = this._readyHistory.filter(Boolean).length;
      if (this._readyHistory.length >= this.options.readyVotes &&
          readyCount >= this.options.readyVotes) {
        this._phase = PLAN_PHASE.READY;
        return {
          kind: "ready",
          phase: this._phase,
          readyCount,
          window: this._readyHistory.length,
        };
      }
      return {
        kind: "ready_pending",
        phase: this._phase,
        readyCount,
        required: this.options.readyVotes,
      };
    }

    const action = normalizeAction(plan.action);
    const cue = this._cue(plan);
    if (cue === this._acceptedCue) {
      this._pendingAction = null;
      this._pendingActionCount = 0;
      // 同方向也可能從「往左」變成「再往左一點」。不能永遠卡在舊句子。
      const advice = plan.advice ?? "";
      const update = advice !== this._acceptedAdvice &&
        now - this._adviceAt >= this.options.adviceRefreshMs;
      if (update) {
        this._acceptedAdvice = advice;
        this._adviceAt = now;
      }
      return { kind: "guidance", phase: this._phase, update, plan };
    }

    if (cue === this._pendingAction) {
      this._pendingActionCount++;
    } else {
      this._pendingAction = cue;
      this._pendingActionCount = 1;
    }

    if (this._pendingActionCount >= this.options.guidanceConfirmations) {
      this._acceptedAction = action;
      this._acceptedCue = cue;
      this._acceptedAdvice = plan.advice ?? "";
      this._adviceAt = now;
      this._pendingAction = null;
      this._pendingActionCount = 0;
      return {
        kind: "guidance",
        phase: this._phase,
        update: true,
        plan,
      };
    }

    return { kind: "guidance_pending", phase: this._phase };
  }

  _pushReady(value) {
    this._readyHistory.push(!!value);
    while (this._readyHistory.length > this.options.readyWindow) {
      this._readyHistory.shift();
    }
  }
}
