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

/**
 * 列出所有相機。要在取得權限之後呼叫。
 * @returns {Promise<Array<{id:string,label:string,facing:string}>>}
 */
export async function list() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    cached = all.filter((d) => d.kind === "videoinput");
    return cached.map((d, i) => ({
      id: d.deviceId,
      label: prettify(d.label, i),
      facing: guessFacing(d.label),
    }));
  } catch {
    return [];
  }
}

/**
 * 把冗長的裝置名稱變成看得懂的短標籤。
 * 原始 label 通常長這樣：
 *   "camera2 0, facing back (0a1b2c3d)"
 *   "Back Ultra Wide Camera"
 */
function prettify(label, index) {
  if (!label) return `鏡頭 ${index + 1}`;

  const l = label.toLowerCase();
  const parts = [];

  if (l.includes("front") || l.includes("user")) parts.push("前");
  else if (l.includes("back") || l.includes("environment")) parts.push("後");

  if (l.includes("ultra") || l.includes("wide")) parts.push("廣角");
  else if (l.includes("tele")) parts.push("長焦");
  else if (l.includes("macro")) parts.push("微距");
  else if (l.includes("depth")) parts.push("景深");

  return parts.length ? parts.join("") : `鏡頭 ${index + 1}`;
}

function guessFacing(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("front") || l.includes("user")) return "user";
  if (l.includes("back") || l.includes("environment")) return "environment";
  return "unknown";
}

/** 這台裝置有幾顆相機 */
export function count() {
  return cached.length;
}
