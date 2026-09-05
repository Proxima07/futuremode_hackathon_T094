/**
 * 顯示目前使用的版型，並允許手動切換。
 *
 * 手動切換不只是開發方便，它是產品功能：
 * AI 選的版型不一定合使用者的意，要讓他能改。
 * Demo 時也可以用這個展示四種版型。
 */

export class LayoutBadge {
  /**
   * @param {HTMLElement} el
   * @param {Array} layouts        所有版型
   * @param {(layout)=>void} onPick 使用者手動選擇時的回呼
   */
  constructor(el, layouts, onPick) {
    this.el = el;
    this.layouts = layouts;
    this.onPick = onPick;
    this.index = 0;
    this.locked = false;    // 使用者手動選過之後，AI 就不再自動改
    this.adjusted = false;  // 這次的版型有沒有被微調過
    this.flipped = false;   // 是否因現場方向而左右／上下翻向
    this.dynamicName = null; // 有值代表正在用 VLM 生成的動態版型
    this.phase = "searching";

    el.addEventListener("click", () => this._next());
  }

  /**
   * VLM 選了內建版型。
   * @param {boolean|Object} adjustment 是否／如何做過微調
   */
  setAuto(layoutId, adjustment = false) {
    if (this.locked) return;
    this.dynamicName = null;
    this.adjusted = !!adjustment;
    this.flipped = typeof adjustment === "object" &&
      (!!adjustment.mirror || !!adjustment.flip_y);
    const i = this.layouts.findIndex((l) => l.id === layoutId);
    if (i >= 0) this.index = i;
    this._render();
  }

  /** VLM 生成了動態版型。名稱直接顯示，不對應到內建清單 */
  setDynamic(name) {
    if (this.locked) return;
    this.dynamicName = name || "臨時版型";
    this.adjusted = false;
    this.flipped = false;
    this._render();
  }

  get current() {
    return this.layouts[this.index];
  }

  setPhase(phase) {
    this.phase = phase;
    this._render();
  }

  _next() {
    this.dynamicName = null;
    this.adjusted = false;
    this.flipped = false;
    this.index = (this.index + 1) % this.layouts.length;
    this.locked = true;
    this._render();
    this.onPick?.(this.current);
  }

  /** 解除鎖定，交還給自動判斷 */
  unlock() {
    this.locked = false;
    this._render();
  }

  _render() {
    const name = this.dynamicName ?? this.current?.name ?? "—";
    const tag = this.phase === "ready"
      ? "可拍攝"
      : this.locked
      ? "手動"
      : this.phase === "guiding"
        ? "已定案"
      : this.dynamicName
        ? "AI 生成"
        : this.flipped
          ? "已翻向"
          : this.adjusted
            ? "已微調"
            : "自動";
    // 動態版型名稱來自模型，不能當 HTML 插入。
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.textContent = tag;
    this.el.replaceChildren(nameEl, tagEl);
  }
}
