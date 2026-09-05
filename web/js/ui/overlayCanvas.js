/**
 * 疊層畫布。整個產品最重要的視覺元件。
 *
 * ────────────────────────────────────────────────
 * 這一版的兩個修正
 *
 * 1. 尺寸用 ResizeObserver 持續校正。
 *    原本只在建構時量一次 getBoundingClientRect，
 *    如果當下版面還沒穩定（字體載入、網址列收合、
 *    startScreen 的淡出動畫），量到的尺寸就是錯的，
 *    框的位置會整個偏掉。
 *
 * 2. 加了暗化遮罩。
 *    框以外的區域壓暗，框內維持原樣。
 *    這是取景器的標準做法，視覺上框會非常明顯，
 *    使用者的注意力自然被導向該放東西的地方。
 * ────────────────────────────────────────────────
 */

import { COLORS, CONFIG } from "../lib/config.js";
import { toPixels, center } from "../lib/geometry.js";

/** 框外的暗化程度。0 = 不暗化，1 = 全黑。可在 config.js 調整 */
const MASK_ALPHA = CONFIG.MASK_ALPHA;

/** 畫布單邊的上限。超過就是出事了，見 _resize 的說明 */
const MAX_EDGE = 4096;

export class OverlayCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {() => void} [onResize] 尺寸改變時呼叫，讓上層重畫
   */
  constructor(canvas, onResize) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = 0;
    this.h = 0;
    this.dpr = window.devicePixelRatio || 1;
    this.onResize = onResize ?? null;
    this.drawCount = 0;
    /** 遮罩強度。設成 0 就是完全透明的疊層，只剩框線 */
    this.maskAlpha = MASK_ALPHA;
    this.resizeCount = 0;
    /** 偵測到尺寸失控時設為 true，除錯面板會顯示 */
    this.runaway = false;

    this._resize();

    // 持續校正尺寸。這是修正框位置跑掉的關鍵。
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this._resize());
      // 觀察父容器。觀察畫布自己會因為點陣尺寸變動而重複觸發。
      this._ro.observe(canvas.parentElement ?? canvas);
    }
    window.addEventListener("orientationchange", () =>
      setTimeout(() => this._resize(), 250)
    );
    // 保險：版面穩定後再量一次
    setTimeout(() => this._resize(), 300);
  }

  /**
   * ────────────────────────────────────────────────
   * 量的是「父容器」，不是畫布自己。這是關鍵。
   *
   * <canvas> 是替換元素，改變它的點陣尺寸會連帶改變
   * 它的版面尺寸。如果拿畫布自己的 getBoundingClientRect()
   * 當依據，就會變成：
   *
   *   量到 300x150 → 設點陣 600x300 → 版面變 600x300
   *   → ResizeObserver 觸發 → 量到 600x300 → 設 1200x600 → ...
   *
   * 指數成長直到顯示卡記憶體耗盡，畫面全白。
   *
   * 父容器的尺寸不會被畫布影響，所以迴圈從源頭就不存在，
   * 而且完全不依賴 CSS 有沒有寫對。
   * ────────────────────────────────────────────────
   */
  _resize() {
    const host = this.canvas.parentElement ?? this.canvas;
    const rect = host.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (!w || !h) return;
    if (w === this.w && h === this.h) return;

    // ── 失控成長的保險絲 ──────────────────────────
    // 正常情況不會觸發。會觸發代表 CSS 少了
    // #overlay { width:100%; height:100% }，
    // 導致畫布的點陣尺寸回過頭改變它自己的版面尺寸，
    // 形成指數成長，最後把顯示卡記憶體吃光、畫面全白。
    if (w > MAX_EDGE || h > MAX_EDGE) {
      console.error(
        `畫布尺寸異常 ${w}x${h}，已停止調整。` +
        "請檢查 CSS 是否漏掉 #overlay 的 width/height。"
      );
      this.runaway = true;
      return;
    }
    this.resizeCount++;
    if (this.resizeCount > 40) {
      console.error("畫布尺寸調整次數異常，已停止以避免拖垮瀏覽器。");
      this.runaway = true;
      return;
    }

    this.w = w;
    this.h = h;
    this.dpr = window.devicePixelRatio || 1;

    // 點陣尺寸：實際像素，畫出來才不會糊
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    // 版面尺寸：明確寫死，不要讓它跟著點陣尺寸跑。
    // 就算 CSS 漏了 width/height，這裡也會補上。
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 尺寸變了，畫布內容會被清空，必須重畫
    this.onResize?.();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  /**
   * 畫出整個版型。
   *
   * @param {Object} layout
   * @param {Object} [opts]
   * @param {Object<string,string>} [opts.items]    slot id → 物品名稱（VLM 給的）
   * @param {Object<string,boolean>} [opts.aligned] slot id → 是否已對齊
   * @param {Object<string,{dx:number,dy:number}>} [opts.arrows]
   * @param {boolean} [opts.mask]  是否畫暗化遮罩，預設 true
   */
  draw(layout, opts = {}) {
    const { items = {}, aligned = {}, arrows = {}, mask = true } = opts;
    if (!this.w || !this.h) this._resize();
    if (!this.w || !this.h) return;

    this.clear();
    this.drawCount++;

    // depth 小的先畫，才會被前面的疊在上面
    const ordered = [...layout.slots].sort((a, b) => a.depth - b.depth);

    // 三分法、黃金螺旋等版型使用構圖線與視覺錨點，
    // 不畫暗化遮罩與大型物件框，避免反過來破壞原本已經好看的場景。
    if (layout.guideOnly && layout.composition) {
      this._drawCompositionGuide(layout.composition);
      for (const slot of ordered) {
        const item = items[slot.id] ?? null;
        // 沒有第二個物件時，不顯示「陪襯或留白」錨點。
        // 構圖線本身已經能表示留白方向，多一顆空錨點只會遮住取景畫面。
        if (slot.optional && !item) continue;
        this._drawAnchor(slot, item, !!aligned[slot.id]);
      }
      return;
    }

    // 沒東西可放的 optional 位置不挖洞，避免畫面破碎
    const holes = ordered.filter((s) => !s.optional || items[s.id]);
    if (mask) this._drawMask(holes.length ? holes : ordered);

    for (const slot of ordered) {
      const item = items[slot.id] ?? null;
      this._drawSlot(slot, {
        item,
        isEmpty: !item,
        isAligned: !!aligned[slot.id],
      });

      const arrow = arrows[slot.id];
      if (arrow && !aligned[slot.id]) this._drawArrow(slot, arrow);
    }
  }

  /** 繪製三分法、黃金比例、螺旋、三角形或對角線。 */
  _drawCompositionGuide(composition) {
    const type = composition.type;
    const transform = composition.transform ?? {};
    const ctx = this.ctx;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(0,0,0,.65)";
    ctx.shadowBlur = 5;

    if (type === "thirds" || type === "golden_grid") {
      const cuts = type === "thirds" ? [1 / 3, 2 / 3] : [0.382, 0.618];
      for (const v of cuts) {
        this._guideLine([[v, 0.04], [v, 0.96]], transform);
        this._guideLine([[0.04, v], [0.96, v]], transform);
      }
    } else if (type === "triangle") {
      const top = [0.50, 0.14];
      const left = [0.08, 0.80];
      const right = [0.92, 0.80];
      this._guideLine([top, left, right, top], transform, true);
    } else if (type === "diagonal") {
      this._guideLine([[0.05, 0.12], [0.95, 0.82]], transform, true);
      // 一條較淡的平行線，讓長條主體比較容易順著動線擺放。
      this._guideLine([[0.05, 0.28], [0.82, 0.88]], transform, false, 0.42);
    } else if (type === "golden_spiral") {
      // 黃金比例的輔助分割線，讓螺旋眼的位置更容易辨識。
      this._guideLine([[0.618, 0.08], [0.618, 0.92]], transform, false, 0.38);
      this._guideLine([[0.08, 0.382], [0.92, 0.382]], transform, false, 0.38);

      const phi = (1 + Math.sqrt(5)) / 2;
      const growth = Math.log(phi) / (Math.PI / 2);
      const points = [];
      const end = Math.PI * 4;
      for (let i = 0; i <= 180; i++) {
        const angle = end * i / 180;
        const radius = 0.008 * Math.exp(growth * angle);
        points.push([
          0.618 + Math.cos(angle) * radius,
          0.382 + Math.sin(angle) * radius,
        ]);
      }
      ctx.strokeStyle = "rgba(251,191,36,.92)";
      ctx.lineWidth = 2.4;
      this._guideLine(points, transform, true, 0.92, false);
    } else if (type === "portrait_environment") {
      // 眼睛／臉部落在一側交點，另外約三分之二保留環境敘事。
      // mirror 會把人物側與留白側一起翻轉。
      this._guideLine([[1 / 3, 0.07], [1 / 3, 0.93]], transform, true);
      this._guideLine([[0.07, 0.30], [0.93, 0.30]], transform, false, 0.48);
    } else if (type === "portrait_center") {
      // 對稱環境只需要清楚的中軸與眼睛高度，不用再疊大型人物框。
      this._guideLine([[0.50, 0.06], [0.50, 0.94]], transform, true);
      this._guideLine([[0.12, 0.29], [0.88, 0.29]], transform, false, 0.48);
    }

    ctx.restore();
  }

  /** 把正規化座標套用 LLM 的受約束調整，再轉成畫布像素。 */
  _guidePoint([px, py], transform = {}) {
    const {
      mirror = false, scale = 1, shift_x = 0, shift_y = 0,
    } = transform;
    let x = mirror ? 1 - px : px;
    let y = py;
    x = 0.5 + (x - 0.5) * scale + shift_x;
    y = 0.5 + (y - 0.5) * scale + shift_y;
    return [x * this.w, y * this.h];
  }

  _guideLine(points, transform, strong = false, alpha = 0.72,
             setDefaultStyle = true) {
    if (!points.length) return;
    const ctx = this.ctx;
    if (setDefaultStyle) {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = strong ? 2.2 : 1.35;
    }
    ctx.beginPath();
    const [x0, y0] = this._guidePoint(points[0], transform);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < points.length; i++) {
      const [x, y] = this._guidePoint(points[i], transform);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** 構圖引導版型只畫小型交點，不畫限制物件尺寸的大框。 */
  _drawAnchor(slot, item, isAligned) {
    const [nx, ny] = slot.anchor ?? center(slot.box);
    const x = nx * this.w;
    const y = ny * this.h;
    const color = isAligned
      ? COLORS.aligned
      : COLORS[slot.prefer] ?? COLORS.any;
    const radius = slot.prefer === "hero" ? 9 : 7;
    const ctx = this.ctx;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = "rgba(0,0,0,.36)";
    ctx.lineWidth = isAligned ? 4 : 2.5;
    ctx.shadowColor = "rgba(0,0,0,.65)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - radius - 6, y);
    ctx.lineTo(x + radius + 6, y);
    ctx.moveTo(x, y - radius - 6);
    ctx.lineTo(x, y + radius + 6);
    ctx.stroke();
    ctx.restore();

    const text = item ?? slot.label;
    if (text) this._label(text, x - 44, y - 16, 88, 32, color, !item);
  }

  /**
   * 框以外的區域壓暗，讓框非常明顯。
   *
   * ────────────────────────────────────────────────
   * 用「單一路徑 + even-odd 填充規則」一次畫完。
   *
   * 原本的做法是先填滿整張畫布，再用
   * globalCompositeOperation = "destination-out" 把框挖掉。
   * 那樣要切換合成模式、而且是兩次全畫布的操作，
   * 成本高，也比較容易干擾底下影片的合成圖層。
   *
   * even-odd 的原理：外框走一圈、每個洞各走一圈，
   * 被奇數個路徑包住的區域才填色。
   * 洞在外框裡面（被 2 個路徑包住，偶數），所以不填，
   * 自然就透出底下的相機畫面。
   *
   * 一次 fill()，不切換任何模式。
   * ────────────────────────────────────────────────
   */
  _drawMask(slots) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();

    // 外框：整張畫布
    ctx.rect(0, 0, this.w, this.h);

    // 每個目標框各是一個子路徑，會變成洞
    for (const slot of slots) {
      const { x, y, w, h } = toPixels(slot.box, this.w, this.h);
      this._roundRectPath(x, y, w, h, Math.min(14, w * 0.08, h * 0.08));
    }

    ctx.fillStyle = `rgba(0,0,0,${this.maskAlpha})`;
    ctx.fill("evenodd");
    ctx.restore();
  }

  _drawSlot(slot, { item, isEmpty, isAligned }) {
    const ctx = this.ctx;
    const { x, y, w, h } = toPixels(slot.box, this.w, this.h);
    const color = isAligned ? COLORS.aligned : COLORS[slot.prefer] ?? COLORS.any;
    const r = Math.min(14, w * 0.08, h * 0.08);

    ctx.save();

    ctx.setLineDash(isEmpty ? [8, 7] : []);
    ctx.lineWidth = isAligned ? 5 : isEmpty ? 2.5 : 4;
    ctx.strokeStyle = color;
    ctx.globalAlpha = isEmpty ? 0.55 : 1;
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 6;
    this._roundRect(x, y, w, h, r);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (isAligned) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 四個角加粗，視覺上更像取景框
    if (!isEmpty) {
      ctx.setLineDash([]);
      ctx.lineWidth = 6;
      ctx.strokeStyle = color;
      this._corners(x, y, w, h, Math.min(24, w * 0.24, h * 0.24));
    }

    ctx.restore();

    // 標籤。優先顯示 VLM 給的物品名稱，沒有才用版型的預設說明
    const text = item ?? slot.label;
    if (text) this._label(text, x, y, w, h, color, isEmpty);
  }

  /**
   * 標籤。靠近畫面上緣時改畫在框內，避免被切掉。
   * 這是原本標籤看起來被切掉的原因。
   */
  _label(text, x, y, w, h, color, dim) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "600 14px system-ui, 'Noto Sans TC', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const padX = 10;
    const boxW = ctx.measureText(text).width + padX * 2;
    const boxH = 25;
    const cx = x + w / 2;

    // 預設畫在框上方；空間不夠就改畫在框內上緣
    let cy = y - boxH / 2 - 6;
    if (cy - boxH / 2 < 4) cy = y + boxH / 2 + 8;

    ctx.globalAlpha = dim ? 0.6 : 1;
    ctx.fillStyle = "rgba(0,0,0,.72)";
    this._roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 12);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy + 0.5);
    ctx.restore();
  }

  _drawArrow(slot, { dx, dy }) {
    const ctx = this.ctx;
    const [ncx, ncy] = center(slot.box);
    const px = ncx * this.w;
    const py = ncy * this.h;

    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    // dx/dy 是物件相對目標的偏移，箭頭要指向相反方向
    const ux = -dx / len;
    const uy = -dy / len;
    const L = Math.min(64, this.w * 0.14);

    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,0,0,.6)";
    ctx.shadowBlur = 6;

    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + ux * L, py + uy * L);
    ctx.stroke();

    const hx = px + ux * L;
    const hy = py + uy * L;
    const a = Math.atan2(uy, ux);
    const s = 13;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - s * Math.cos(a - 0.42), hy - s * Math.sin(a - 0.42));
    ctx.lineTo(hx - s * Math.cos(a + 0.42), hy - s * Math.sin(a + 0.42));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 開一條新路徑並畫圓角矩形 */
  _roundRect(x, y, w, h, r) {
    this.ctx.beginPath();
    this._roundRectPath(x, y, w, h, r);
  }

  /** 把圓角矩形「附加」到目前的路徑上，不會清掉既有路徑 */
  _roundRectPath(x, y, w, h, r) {
    const ctx = this.ctx;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  _corners(x, y, w, h, c) {
    const ctx = this.ctx;
    for (const pts of [
      [[x, y + c], [x, y], [x + c, y]],
      [[x + w - c, y], [x + w, y], [x + w, y + c]],
      [[x + w, y + h - c], [x + w, y + h], [x + w - c, y + h]],
      [[x + c, y + h], [x, y + h], [x, y + h - c]],
    ]) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.stroke();
    }
  }
}
