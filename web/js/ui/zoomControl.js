/**
 * 相機縮放控制。
 *
 * UI 本身不碰 MediaStream，真正套用倍率的函式由 camera.js 傳入。
 * input 事件可能在拖曳時一秒觸發數十次，因此這裡只保留最新目標值，
 * 並依序套用，避免較慢的舊請求最後才完成、把倍率倒退回去。
 */
export class ZoomControl {
  /**
   * @param {HTMLElement} root
   * @param {(value:number)=>Promise<Object>} applyZoom
   */
  constructor(root, applyZoom) {
    this.root = root;
    this.applyZoom = applyZoom;
    this.range = root.querySelector("#zoomRange");
    this.out = root.querySelector("#zoomOut");
    this.in = root.querySelector("#zoomIn");
    this.label = root.querySelector("#zoomValue");
    this.info = null;
    this.pending = null;
    this.busy = false;

    this.range.addEventListener("input", () => {
      const value = Number(this.range.value);
      this._show(value);
      this._queue(value);
    });
    this.out.addEventListener("click", () => this._step(-1));
    this.in.addEventListener("click", () => this._step(1));
  }

  /** 套用新鏡頭的能力範圍。 */
  configure(info) {
    this.info = info;
    this.pending = null;

    if (!info?.supported) {
      this.root.classList.add("hidden");
      return;
    }

    // 按一次至少變動 0.1×，避免硬體回報極小 step 時按鈕像沒反應。
    const step = Math.max(info.step || 0.1, 0.1);
    this.range.min = String(info.min);
    this.range.max = String(info.max);
    this.range.step = String(step);
    this.range.value = String(info.value);
    this.root.classList.remove("hidden");
    this._show(info.value);
  }

  _step(direction) {
    if (!this.info?.supported) return;
    const step = Number(this.range.step) || 0.1;
    const min = Number(this.range.min);
    const max = Number(this.range.max);
    const raw = Math.max(
      min,
      Math.min(max, Number(this.range.value) + direction * step)
    );
    // 避免 1.4 - 0.1 變成 1.2999999999999998 這類浮點誤差，
    // 某些手機的 applyConstraints 會因此拒絕不符合 step 的值。
    const value = Math.round(raw * 10000) / 10000;
    this.range.value = String(value);
    this._show(value);
    this._queue(value);
  }

  _show(value) {
    this.label.textContent = `${Number(value).toFixed(1)}×`;
    const min = Number(this.range.min);
    const max = Number(this.range.max);
    this.out.disabled = value <= min + 1e-6;
    this.in.disabled = value >= max - 1e-6;
  }

  _queue(value) {
    this.pending = value;
    if (!this.busy) this._flush();
  }

  async _flush() {
    this.busy = true;
    while (this.pending !== null) {
      const target = this.pending;
      this.pending = null;
      try {
        const actual = await this.applyZoom(target);
        if (actual?.supported) {
          this.info = actual;
          this.range.value = String(actual.value);
          this._show(actual.value);
        }
      } catch (err) {
        console.warn("相機縮放失敗：", err);
        // 套用失敗時回到瀏覽器實際接受的上一個值。
        if (this.info) {
          this.range.value = String(this.info.value);
          this._show(this.info.value);
        }
      }
    }
    this.busy = false;
  }
}
