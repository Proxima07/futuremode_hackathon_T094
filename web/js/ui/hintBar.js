/**
 * 畫面下方的文字提示條。
 *
 * 刻意做得很簡單：一次只顯示一句話。
 * 使用者在搬東西的時候沒有心力讀第二行。
 */

export class HintBar {
  /** @param {HTMLElement} el */
  constructor(el) {
    this.el = el;
    this.current = "";
    this.holdUntil = 0;
    this.pending = null;
    this.timer = null;
  }

  /**
   * @param {string} text  要顯示的話。空字串代表隱藏
   * @param {"info"|"good"|"warn"} [tone]
   */
  set(text, tone = "info", {holdMs = 0, immediate = false} = {}) {
    // 相同句子不延長停留時間，也取消已被新結果推翻的排隊文字。
    if (text === this.current && tone === this.tone) {
      this._cancelPending();
      if (immediate) this.holdUntil = 0;
      return;
    }
    const remaining = this.holdUntil - performance.now();
    if (!immediate && remaining > 0) {
      this.pending = {text, tone, holdMs}; // 只留最新一句，不輪播過時指示
      if (this.timer === null) {
        this.timer = setTimeout(() => {
          const pending = this.pending;
          this.timer = null;
          this.pending = null;
          if (pending) this.set(pending.text, pending.tone, {...pending, immediate: true});
        }, remaining);
      }
      return;
    }
    this._cancelPending();
    this.holdUntil = performance.now() + Math.max(0, Number(holdMs) || 0);
    this.current = text;
    this.tone = tone;

    this.el.textContent = text;
    this.el.dataset.tone = tone;
    this.el.style.opacity = text ? "1" : "0";
  }

  clear() {
    this.set("", "info", {immediate: true});
  }

  _cancelPending() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
