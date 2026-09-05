/**
 * 鏡頭列舉與切換。
 *
 * ────────────────────────────────────────────────
 * 兩個一定會踩到的限制
 *
 * 1. 沒有取得相機權限之前，enumerateDevices() 回傳的
 *    label 全部是空字串，而且可能連裝置都列不全。
 *    所以一定要先成功 getUserMedia 一次，才能列舉。
 *
 * 2. 切換鏡頭一定要先 stop() 舊的串流。
 *    很多手機同時只能開一顆鏡頭，不先關會拿到
 *    NotReadableError。
 * ────────────────────────────────────────────────
 */

/** @type {MediaDeviceInfo[]} */
let cached = [];
const STORAGE_KEY = "snapfit.preferred-camera.v1";

/**
 * 列出所有相機。要在取得權限之後呼叫。
 * @returns {Promise<Array<{
 *   id:string,label:string,facing:string,lens:string,zoomMin:number|null
 * }>>}
 */
export async function list() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    cached = all.filter((d) => d.kind === "videoinput");
    const cameras = cached.map((d, i) => {
      const lens = guessLens(d.label);
      const caps = readCapabilities(d);
      const facing = guessFacing(d.label, caps);
      return {
        id: d.deviceId,
        label: prettify(d.label, i, lens, facing),
        facing,
        lens,
        zoomMin: Number.isFinite(caps.zoom?.min) ? caps.zoom.min : null,
      };
    });
    return disambiguate(cameras);
  } catch {
    return [];
  }
}

/** InputDeviceInfo.getCapabilities 並非每個瀏覽器都有，讀不到就回空物件。 */
function readCapabilities(device) {
  try {
    return typeof device.getCapabilities === "function"
      ? device.getCapabilities() ?? {}
      : {};
  } catch {
    return {};
  }
}

/**
 * 把冗長的裝置名稱變成看得懂的短標籤。
 * 原始 label 通常長這樣：
 *   "camera2 0, facing back (0a1b2c3d)"
 *   "Back Ultra Wide Camera"
 */
function prettify(label, index, lens = "unknown", facing = "unknown") {
  if (!label && facing === "environment") return "後";
  if (!label && facing === "user") return "前";
  if (!label) return `鏡頭 ${index + 1}`;

  const l = label.toLowerCase();
  const parts = [];

  if (facing === "user") parts.push("前");
  else if (facing === "environment") parts.push("後");
  else if (l.includes("front") || l.includes("user")) parts.push("前");
  else if (l.includes("back") || l.includes("environment")) parts.push("後");

  if (lens === "ultrawide") parts.push("超廣角");
  else if (lens === "wide") parts.push("廣角");
  else if (lens === "tele") parts.push("長焦");
  else if (lens === "macro") parts.push("微距");
  else if (lens === "depth") parts.push("景深");

  return parts.length ? parts.join("") : `鏡頭 ${index + 1}`;
}

function guessLens(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("ultra wide") || l.includes("ultrawide") ||
      l.includes("ultra-wide") || /\b0[.,][456]\s*x\b/.test(l)) {
    return "ultrawide";
  }
  if (l.includes("tele") || /\b[235]\s*x\b/.test(l)) return "tele";
  if (l.includes("macro")) return "macro";
  if (l.includes("depth")) return "depth";
  if (l.includes("wide")) return "wide";
  return "unknown";
}

/** 多顆鏡頭都只叫「後」時，至少顯示成「後 1／後 2」，讓人能比較。 */
function disambiguate(cameras) {
  const totals = new Map();
  const seen = new Map();
  for (const camera of cameras) {
    totals.set(camera.label, (totals.get(camera.label) ?? 0) + 1);
  }
  return cameras.map((camera) => {
    if ((totals.get(camera.label) ?? 0) < 2) return camera;
    const n = (seen.get(camera.label) ?? 0) + 1;
    seen.set(camera.label, n);
    return { ...camera, label: `${camera.label} ${n}` };
  });
}

function guessFacing(label, capabilities = {}) {
  const rawModes = capabilities.facingMode;
  const modes = Array.isArray(rawModes) ? rawModes : [rawModes];
  if (modes.includes("environment")) return "environment";
  if (modes.includes("user")) return "user";

  const l = (label || "").toLowerCase();
  if (l.includes("front") || l.includes("user")) return "user";
  if (l.includes("back") || l.includes("environment")) return "environment";
  return "unknown";
}

/**
 * 挑選啟動時最合適的鏡頭。
 *
 * 優先序：使用者上次手動選擇 > 明確標示超廣角 > 較小的硬體最小倍率
 * > 一般廣角 > 瀏覽器目前預設。Web API 沒有標準焦距欄位，因此名稱與
 * zoom 能力都看不出來時不亂猜，保留目前鏡頭讓使用者手動切換。
 */
export function preferred(cameras, currentId = null) {
  if (!Array.isArray(cameras) || cameras.length === 0) return null;

  const remembered = rememberedId();
  const saved = cameras.find((camera) => camera.id === remembered);
  if (saved) return saved;

  const current = cameras.find((camera) => camera.id === currentId) ?? null;
  const knownBacks = cameras.filter(
    (camera) => camera.facing === "environment"
  );
  const nonFront = cameras.filter((camera) => camera.facing !== "user");
  const candidates = knownBacks.length ? knownBacks : nonFront;
  const usable = candidates.filter(
    (camera) => !["tele", "macro", "depth"].includes(camera.lens)
  );
  const pool = usable.length ? usable : candidates.length ? candidates : cameras;

  const ultrawide = pool.find((camera) => camera.lens === "ultrawide");
  if (ultrawide) return ultrawide;

  // 裝置名稱若完全沒有前／後資訊，就不能拿 zoomMin 猜鏡頭種類：
  // 前鏡頭也可能剛好有較小的最小倍率。這時保留 facingMode 已選到的
  // environment track，讓使用者從鏡頭按鈕親自比較最可靠。
  if (!knownBacks.length && current) return current;

  const withZoom = pool
    .filter((camera) => Number.isFinite(camera.zoomMin))
    .sort((a, b) => a.zoomMin - b.zoomMin);
  if (withZoom.length > 1 &&
      withZoom[0].zoomMin + 0.05 < withZoom[withZoom.length - 1].zoomMin) {
    return withZoom[0];
  }

  const wide = pool.find((camera) => camera.lens === "wide");
  if (wide) return wide;

  return current ?? pool[0];
}

/** 記住使用者親自切換後的鏡頭；裝置 ID 失效時 preferred 會自動忽略。 */
export function remember(deviceId) {
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEY, deviceId);
  } catch { /* 無痕模式或儲存被封鎖時維持當次選擇即可 */ }
}

function rememberedId() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 這台裝置有幾顆相機 */
export function count() {
  return cached.length;
}
