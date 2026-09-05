/**
 * 情境選擇與鏡頭切換的介面。
 *
 * 兩者都做成「點一下就循環到下一個」，
 * 因為手機上的下拉選單體驗很差，而選項都不多。
 */

/** 情境選擇。點一下換下一個情境 */
export class IntentPicker {
  /**
   * @param {HTMLElement} el
   * @param {Array} intents
   * @param {(intent)=>void} onPick
   */
  constructor(el, intents, onPick) {
    this.el = el;
    this.intents = intents;
    this.onPick = onPick;
    this.index = 0;
    el.addEventListener("click", () => this.next());
    this._render();
  }

  get current() {
    return this.intents[this.index];
  }

  next() {
    this.index = (this.index + 1) % this.intents.length;
    this._render();
    this.onPick?.(this.current);
  }

  setById(id) {
    const i = this.intents.findIndex((x) => x.id === id);
    if (i >= 0 && i !== this.index) {
      this.index = i;
      this._render();
    }
  }

  _render() {
    const it = this.current;
    this.el.innerHTML =
      `<span class="ico">${it.icon}</span><span class="name">${it.name}</span>`;
  }
}

/**
 * 鏡頭切換。
 *
 * 只有一顆鏡頭時整個隱藏，免得按了沒反應。
 */
export class CameraPicker {
  /**
   * @param {HTMLElement} el
   * @param {(deviceId:string)=>void} onPick
   */
  constructor(el, onPick) {
    this.el = el;
    this.onPick = onPick;
    this.devices = [];
    this.index = 0;
    this.busy = false;

    el.addEventListener("click", () => this.next());
  }

  /** @param {Array<{id:string,label:string,facing:string}>} devices */
  setDevices(devices, currentId = null) {
    this.devices = devices;
    if (currentId) {
      const i = devices.findIndex((d) => d.id === currentId);
      if (i >= 0) this.index = i;
    }
    this.el.classList.toggle("hidden", devices.length < 2);
    this._render();
  }

  get current() {
    return this.devices[this.index] ?? null;
  }

  async next() {
    if (this.busy || this.devices.length < 2) return;
    this.busy = true;
    this.index = (this.index + 1) % this.devices.length;
    this._render();
    try {
      await this.onPick?.(this.current.id);
    } finally {
      this.busy = false;
    }
  }

  _render() {
    const d = this.current;
    this.el.innerHTML =
      `<span class="ico">⟳</span><span class="name">${d?.label ?? "鏡頭"}</span>`;
  }
}
