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
  }

  /**
   * @param {string} text  要顯示的話。空字串代表隱藏
   * @param {"info"|"good"|"warn"} [tone]
   */
  set(text, tone = "info") {
    if (text === this.current) return;   // 沒變就不要重繪，避免閃爍
    this.current = text;

    this.el.textContent = text;
    this.el.dataset.tone = tone;
    this.el.style.opacity = text ? "1" : "0";
  }

  clear() {
    this.set("");
  }
}
