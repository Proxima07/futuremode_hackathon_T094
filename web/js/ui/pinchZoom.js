/**
 * 兩指縮放手勢。
 *
 * ────────────────────────────────────────────────
 * 為什麼改成手勢而不是固定的滑桿
 *
 * 滑桿一直浮在畫面上，會擋住使用者正在取景的區域，
 * 而取景本身就是這個產品的全部。
 * 兩指縮放是相機 App 的通用手勢，不需要教，也不佔畫面。
 *
 * 保留一個「只在縮放時才淡入」的倍率標示，
 * 讓使用者知道現在幾倍，一秒後自動消失。
 * ────────────────────────────────────────────────
 *
 * 這個類別本身不碰 MediaStream，套用倍率的函式由 camera.js 傳入。
 * 兩指移動一秒可以觸發上百次事件，所以只保留最新的目標值依序套用，
 * 避免較慢的舊請求最後才完成、把倍率倒退回去。
 */

export class PinchZoom {
  /**
   * @param {HTMLElement} surface     監聽手勢的區域，通常是整個相機畫面
   * @param {HTMLElement} readout     倍率標示，縮放時才顯示
   * @param {(value:number)=>Promise<Object>} applyZoom
   */
  constructor(surface, readout, applyZoom) {
    this.surface = surface;
    this.readout = readout;
    this.applyZoom = applyZoom;

    this.info = null;          // { supported, min, max, step, current }
    this.pending = null;       // 最新的目標倍率
    this.busy = false;
    this.startDist = 0;
    this.startZoom = 1;
    this.active = false;
    this.hideTimer = null;

    // passive: false 才能 preventDefault，
    // 否則 iOS Safari 會把兩指手勢當成整頁縮放
    const opt = { passive: false };
    surface.addEventListener("touchstart", (e) => this._start(e), opt);
    surface.addEventListener("touchmove", (e) => this._move(e), opt);
    surface.addEventListener("touchend", () => this._end(), opt);
    surface.addEventListener("touchcancel", () => this._end(), opt);

    // 桌機測試用：Ctrl + 滾輪
    surface.addEventListener("wheel", (e) => {
      if (!e.ctrlKey || !this.info?.supported) return;
      e.preventDefault();
      const span = this.info.max - this.info.min;
      this._queue(this._clamp(
        (this.info.current ?? this.info.min) - e.deltaY * span * 0.002
      ));
      this._show();
    }, opt);
  }

  /** 換鏡頭之後要重新套用能力範圍 */
  configure(info) {
    this.info = info;
    this.pending = null;
    if (info?.supported) this._render(info.current ?? info.min);
  }

  get supported() {
    return !!this.info?.supported;
  }

  // ── 手勢 ──────────────────────────────────────

  _start(e) {
    if (e.touches.length !== 2 || !this.supported) return;
    e.preventDefault();
    this.active = true;
    this.startDist = this._dist(e.touches);
    this.startZoom = this.info.current ?? this.info.min;
    this._show();
  }

  _move(e) {
    if (!this.active || e.touches.length !== 2) return;
    e.preventDefault();

    const dist = this._dist(e.touches);
    if (this.startDist <= 0) return;

    // 用倍率相乘而不是相加。手指張開兩倍就放大兩倍，
    // 這樣在任何起始倍率下手感都一致。
    const target = this._clamp(this.startZoom * (dist / this.startDist));
    this._queue(target);
    this._show();
  }

  _end() {
    if (!this.active) return;
    this.active = false;
    this._scheduleHide();
  }

  _dist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  _clamp(v) {
    const { min, max } = this.info;
    return Math.min(max, Math.max(min, v));
  }

  // ── 套用 ──────────────────────────────────────

  /**
   * 只保留最新的目標值。
   * 手勢每秒觸發上百次，逐一送出的話舊請求會後到，
   * 把倍率倒退回去。
   */
  _queue(value) {
    this.pending = value;
    this._render(value);
    this._drain();
  }

  async _drain() {
    if (this.busy || this.pending === null) return;
    this.busy = true;
    while (this.pending !== null) {
      const target = this.pending;
      this.pending = null;
      try {
        const info = await this.applyZoom(target);
        if (info) this.info = info;
      } catch {
        // 這顆鏡頭拒絕了這個倍率就停手，不要一直重試
        this.pending = null;
      }
    }
    this.busy = false;
  }

  // ── 倍率標示 ──────────────────────────────────

  _render(value) {
    if (!this.readout) return;
    this.readout.textContent = `${value.toFixed(1)}×`;
  }

  _show() {
    if (!this.readout) return;
    clearTimeout(this.hideTimer);
    this.readout.classList.remove("hidden");
  }

  _scheduleHide(delay = 1100) {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(
      () => this.readout?.classList.add("hidden"), delay
    );
  }
}
