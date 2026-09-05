/**
 * 相機存取。
 *
 * ────────────────────────────────────────────────
 * 三件一定會踩到的事
 *
 * 1. 必須是 HTTPS。localhost 是例外，其他一律不行。
 *
 * 2. iOS Safari 需要使用者「主動點擊」才能啟動相機，
 *    不能在頁面載入時自動開。
 *
 * 3. video 元素要加 playsinline，否則 iOS 會強制全螢幕播放。
 *
 * ────────────────────────────────────────────────
 * 串流會死掉，而且死掉時瀏覽器只會顯示一個哭臉佔位圖
 *
 * 常見死因：
 *   - 使用者在相機還開著的時候重整頁面，
 *     舊頁面沒釋放硬體，新頁面拿到的串流馬上結束
 *   - 其他分頁或應用程式搶走相機
 *   - 手機切到背景太久，系統回收
 *
 * 所以這一版加了：
 *   - track 的 ended 事件監聽，死掉會通知上層
 *   - 頁面卸載時主動釋放
 *   - 重新啟動的函式
 * ────────────────────────────────────────────────
 */

/** @type {MediaStream | null} */
let stream = null;
/** @type {HTMLVideoElement | null} */
let videoEl = null;
/** @type {(() => void) | null} */
let onLostCallback = null;
/** @type {number | null} */
let watchdogTimer = null;
/** 連續幾次偵測到畫面不正常。連續 3 次才判定為壞掉，避免誤判 */
let badTicks = 0;
/** 自動復原嘗試次數，避免無限重試 */
let recoverAttempts = 0;
/** @type {string | null} 目前使用的鏡頭 deviceId */
let currentDeviceId = null;

/** 最近一次看門狗的觀測值，除錯面板會顯示 */
export const health = {
  readyState: 0,
  videoWidth: 0,
  paused: true,
  trackState: "-",
  trackMuted: false,
  streamActive: false,
  badTicks: 0,
  recovered: 0,
  lastEvent: "-",
};

/**
 * 啟動相機。
 *
 * @param {HTMLVideoElement} video
 * @param {() => void} [onLost] 串流意外中斷時呼叫
 * @returns {Promise<{width:number, height:number}>}
 */
export async function start(video, onLost, deviceId = null) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      "unsupported",
      "這個瀏覽器不支援相機。請改用 Chrome 或 Safari。"
    );
  }

  // 先把可能還握著的舊串流放掉，避免和自己搶硬體
  stop(video);

  videoEl = video;
  onLostCallback = onLost ?? null;

  try {
    // 指定了鏡頭就用 deviceId，否則用 facingMode 讓系統挑後鏡頭。
    // facingMode 用 "environment" 而不是 { exact: "environment" }，
    // 因為桌機沒有後鏡頭，exact 會直接失敗，開發時很不方便。
    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: "environment" };

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...videoConstraints,
        // 不要求太高。送給 VLM 的只有 512px，
        // 拍照存檔用 960 也足夠，而解析度越高影像解碼越吃資源。
        width: { ideal: 960 },
        height: { ideal: 1280 },
      },
    });
  } catch (err) {
    throw toCameraError(err);
  }

  // 監聽串流中斷
  for (const track of stream.getVideoTracks()) {
    track.addEventListener("ended", handleTrackEnded);
  }

  video.srcObject = stream;

  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();

  if (!video.videoWidth || !video.videoHeight) {
    throw new CameraError("no_frame", "相機沒有輸出畫面，請重試。");
  }

  attachVideoEvents(video);
  startWatchdog(video);
  recoverAttempts = 0;
  currentDeviceId =
    stream.getVideoTracks()[0]?.getSettings?.().deviceId ?? deviceId ?? null;

  return { width: video.videoWidth, height: video.videoHeight };
}

/**
 * 切換到指定的鏡頭。
 *
 * 一定要先關掉舊串流才能開新的。很多手機同時只能開一顆鏡頭，
 * 不先關會拿到 NotReadableError。start() 開頭已經會呼叫 stop()，
 * 所以直接重新 start 就好。
 */
export async function switchTo(video, deviceId, onLost) {
  return start(video, onLost, deviceId);
}

/** 目前正在用哪一顆鏡頭 */
export function currentDevice() {
  return currentDeviceId;
}

/**
 * 監聽 video 元素的狀態事件。
 *
 * 影片變空白時通常不會有 JS 錯誤，只會靜靜地觸發這些事件，
 * 所以一定要記下來，不然完全無從查起。
 */
function attachVideoEvents(video) {
  for (const name of ["error", "emptied", "stalled", "suspend",
                      "pause", "waiting", "ended"]) {
    video.addEventListener(name, () => {
      health.lastEvent = `${name} @${new Date().toLocaleTimeString()}`;
      console.warn(`video 事件：${name}`);
      // 被暫停的話直接叫它繼續播，這是最常見的假死
      if (name === "pause" && stream) video.play().catch(() => {});
    });
  }
}

/**
 * 影像看門狗。
 *
 * 每秒檢查一次畫面是不是還活著。
 * 「活著」的定義：video 有尺寸、沒被暫停、track 還在 live。
 *
 * 連續 3 次不正常才動作，避免切分頁之類的短暫狀況造成誤判。
 * 先嘗試自己復原（重新 play、重新接上 srcObject），
 * 兩次都救不回來才通報上層。
 */
function startWatchdog(video) {
  stopWatchdog();
  badTicks = 0;

  watchdogTimer = setInterval(() => {
    const track = stream?.getVideoTracks()?.[0];

    health.readyState = video.readyState;
    health.videoWidth = video.videoWidth;
    health.paused = video.paused;
    health.trackState = track?.readyState ?? "-";
    health.trackMuted = !!track?.muted;
    health.streamActive = !!stream?.active;

    const alive =
      video.videoWidth > 0 &&
      video.readyState >= 2 &&
      !video.paused &&
      track?.readyState === "live";

    if (alive) {
      badTicks = 0;
      health.badTicks = 0;
      return;
    }

    badTicks++;
    health.badTicks = badTicks;
    console.warn(
      `畫面異常 ${badTicks}/3`,
      JSON.parse(JSON.stringify(health))
    );

    if (badTicks < 3) return;

    // 先試著自己救
    if (recoverAttempts < 2 && stream?.active) {
      recoverAttempts++;
      health.recovered = recoverAttempts;
      console.warn(`嘗試自動復原（第 ${recoverAttempts} 次）`);
      video.srcObject = stream;      // 重新接一次
      video.play().catch(() => {});
      badTicks = 0;
      return;
    }

    // 救不回來就通報上層
    stopWatchdog();
    onLostCallback?.();
  }, 1000);
}

function stopWatchdog() {
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function handleTrackEnded() {
  console.warn("相機串流中斷");
  stream = null;
  onLostCallback?.();
}

/** 關閉相機，釋放硬體 */
export function stop(video = videoEl) {
  stopWatchdog();
  if (stream) {
    for (const t of stream.getTracks()) {
      t.removeEventListener("ended", handleTrackEnded);
      t.stop();
    }
  }
  stream = null;
  if (video) video.srcObject = null;
}

/** 串流是否仍然活著。畫面白掉時可以用這個判斷 */
export function isAlive() {
  if (!stream || !stream.active) return false;
  return stream.getVideoTracks().some((t) => t.readyState === "live");
}

// 頁面卸載時主動釋放。
// 不做這件事的話，重整後新頁面很可能拿到一個立刻結束的串流，
// 畫面就變成哭臉佔位圖。
window.addEventListener("pagehide", () => stop());
window.addEventListener("beforeunload", () => stop());

// ── 錯誤處理 ────────────────────────────────────────

export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CameraError";
    this.code = code;
  }
}

function toCameraError(err) {
  const map = {
    NotAllowedError: [
      "denied",
      "相機權限被拒絕。請在瀏覽器的網站設定開啟相機權限，然後重整頁面。",
    ],
    NotFoundError: ["no_device", "找不到相機裝置。"],
    NotReadableError: [
      "in_use",
      "相機被其他程式佔用了。關掉其他會用到相機的分頁或應用程式再試。",
    ],
    OverconstrainedError: ["constraints", "這台裝置不支援要求的相機規格。"],
    SecurityError: [
      "insecure",
      "必須透過 HTTPS 才能使用相機。請用 Cloudflare Tunnel 的網址開啟。",
    ],
  };
  const [code, message] = map[err?.name] ?? [
    "unknown",
    `相機啟動失敗：${err?.message ?? err}`,
  ];
  return new CameraError(code, message);
}
