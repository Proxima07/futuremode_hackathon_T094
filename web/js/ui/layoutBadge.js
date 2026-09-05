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
    this.dynamicName = null; // 有值代表正在用 VLM 生成的動態版型

    el.addEventListener("click", () => this._next());
  }

  /**
   * VLM 選了內建版型。
   * @param {boolean} adjusted 是否有做過微調
   */
  setAuto(layoutId, adjusted = false) {
    if (this.locked) return;
    this.dynamicName = null;
    this.adjusted = adjusted;
    const i = this.layouts.findIndex((l) => l.id === layoutId);
    if (i >= 0) this.index = i;
    this._render();
  }

  /** VLM 生成了動態版型。名稱直接顯示，不對應到內建清單 */
  setDynamic(name) {
    if (this.locked) return;
    this.dynamicName = name || "臨時版型";
    this.adjusted = false;
    this._render();
  }

  get current() {
    return this.layouts[this.index];
  }

  _next() {
    this.dynamicName = null;
    this.adjusted = false;
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
    const tag = this.locked
      ? "已鎖定"
      : this.dynamicName
        ? "AI 生成"
        : this.adjusted
          ? "已微調"
          : "自動";
    this.el.innerHTML =
      `<span class="name">${name}</span><span class="tag">${tag}</span>`;
  }
}
