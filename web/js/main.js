/**
 * SnapFit 前端進入點。
 *
 * 資料流：
 *   相機 → 抓一幀 + 本機算曝光數字
 *        → /api/plan（帶上情境、目前版型、曝光數字）
 *        → VLM 回傳：版型合不合用、物品配置、光線建議
 *        → 套用並重畫
 *
 * 畫面是事件驅動的，不是每秒重畫 N 次。
 * 只有三種情況會重畫：VLM 回新計畫、使用者切換、畫布尺寸改變。
 */

import * as camera from "./camera/camera.js";
import * as devices from "./camera/devices.js";
import { warmup, resetSceneMemory } from "./lib/api.js";
import { RemotePlanner } from "./planner/remotePlanner.js";
import { PlanStabilizer, PLAN_PHASE } from "./planner/planStabilizer.js";
import { summarize, visibleRegion } from "./vision/exposure.js";
import { OverlayCanvas } from "./ui/overlayCanvas.js";
import { HintBar } from "./ui/hintBar.js";
import { LayoutBadge } from "./ui/layoutBadge.js";
import { ZoomControl } from "./ui/zoomControl.js";
import { IntentPicker, CameraPicker } from "./ui/pickers.js";
import { INTENTS, DEFAULT_INTENT } from "./intents.js";
import { ALL, getLayout, layoutsFor } from "./layouts/index.js";
import { applyAdjust, toLayout } from "./layouts/adjust.js";
import { LIGHT_TEXT } from "./guidance/phrases.js";
import { CONFIG } from "./lib/config.js";

console.log(`[SnapFit] ${CONFIG.BUILD ?? "版本不明（config.js 可能是快取的舊檔）"}`);

const $ = (id) => document.getElementById(id);

const el = {
  video: $("camera"),
  canvas: $("overlay"),
  hint: $("hint"),
  light: $("lightBar"),
  badge: $("layoutBadge"),
  intent: $("intentPicker"),
  camera: $("cameraPicker"),
  zoom: $("zoomControl"),
  shutter: $("shutter"),
  status: $("compositionStatus"),
  analysis: $("analysisStatus"),
  reanalyze: $("reanalyzeBtn"),
  start: $("startBtn"),
  startScreen: $("startScreen"),
  error: $("errorBox"),
  debug: $("debug"),
};

let overlay, hint, badge, intentPicker, cameraPicker, zoomControl, planner, debugTimer;
const stabilizer = new PlanStabilizer(CONFIG.STABILITY);

/** 目前的狀態。改變時呼叫 render() 重畫。 */
const state = {
  intent: DEFAULT_INTENT,
  /** 使用者或 VLM 選定的基礎版型 */
  baseLayout: null,
  /** 實際畫出來的版型（可能是調整過或動態生成的） */
  layout: null,
  items: {},
  features: {},
  progress: "searching",
  awaitingCustom: false,
  viewPending: false,
  remove: [],
  advice: "",
  scene: "",
  light: null,
  fit: "good",
  lastPlanAt: 0,
};

state.baseLayout = layoutsFor(state.intent)[0];
state.layout = state.baseLayout;

function render() {
  if (!overlay) return;
  if (stabilizer.phase === PLAN_PHASE.SEARCHING) {
    overlay.clear();
    return;
  }
  try {
    const aligned = stabilizer.phase === PLAN_PHASE.READY
      ? Object.fromEntries(Object.keys(state.items).map((id) => [id, true])) : {};
    overlay.draw(state.layout, { items: state.items, aligned });
  } catch (err) {
    console.error("重畫失敗：", err);
  }
}

// ── 啟動 ────────────────────────────────────────────
// iOS Safari 必須由使用者主動點擊才能開相機

el.start.addEventListener("click", async () => {
  el.start.disabled = true;
  el.start.textContent = "啟動中…";
  el.error.classList.add("hidden");

  try {
    const res = await camera.start(el.video, onCameraLost);
    console.log(`相機解析度 ${res.width}x${res.height}`);
    await onCameraReady();
  } catch (err) {
    el.error.textContent = err.message;
    el.error.classList.remove("hidden");
    el.start.disabled = false;
    el.start.textContent = "重試";
  }
});

async function onCameraReady() {
  el.startScreen.classList.add("hidden");

  overlay ??= new OverlayCanvas(el.canvas, render);
  hint ??= new HintBar(el.hint);

  intentPicker ??= new IntentPicker(el.intent, INTENTS, onIntentChange);
  intentPicker.setById(state.intent.id);

  badge ??= new LayoutBadge(el.badge, layoutsFor(state.intent), onManualPick);
  badge.setAuto(state.baseLayout.id);

  // 鏡頭列舉一定要在取得權限之後，否則 label 全是空的。
  // 多鏡頭手機若能辨識出超廣角，或使用者之前選過另一顆鏡頭，
  // 啟動時先切到那一顆，避免每次都從看起來放大很多的預設鏡頭開始。
  const cameras = await devices.list();
  const preferredCamera = devices.preferred(cameras, camera.currentDevice());
  if (preferredCamera?.id && preferredCamera.id !== camera.currentDevice()) {
    hint.set("正在調整到較合適的相機視野…", "info");
    try {
      const res = await camera.switchTo(
        el.video, preferredCamera.id, onCameraLost
      );
      console.log(
        `已選擇 ${preferredCamera.label} ${res.width}x${res.height}`
      );
    } catch (err) {
      console.info("偏好鏡頭無法啟動，退回系統預設：", err);
      await camera.start(el.video, onCameraLost);
    }
  }

  cameraPicker ??= new CameraPicker(el.camera, onCameraSwitch);
  cameraPicker.setDevices(cameras, camera.currentDevice());

  zoomControl ??= new ZoomControl(el.zoom, async (value) => {
    resumeForView();
    try { return await camera.setZoom(value); }
    finally { resumeForView(); }
  });
  zoomControl.configure(camera.zoomInfo());

  hint.set("正在看畫面…", "info");
  updateLightBar();      // 先顯示「分析光線中」，讓使用者知道它在跑
  render();
  warmup();

  planner ??= new RemotePlanner(el.video, getPlanContext, {
    onPlan, onLight, onCustom, onViewChanged: resumeForView,
    onActivity: updateAnalysisStatus, onPlanDeferred,
  });
  planner.resetLighting();
  startAnalysis();
  planner.start();

  el.shutter.disabled = false;
  el.reanalyze.disabled = false;
}

el.shutter.addEventListener("click", capture);
el.reanalyze.addEventListener("click", () => startAnalysis());
window.addEventListener("orientationchange", () => resumeForView());

function onManualPick(picked) {
  state.baseLayout = picked;
  state.layout = picked;
  state.items = {};
  state.features = {};
  state.remove = [];
  state.advice = "";
  state.awaitingCustom = false;
  state.viewPending = false;
  state.progress = "guiding";
  stabilizer.forceLock({ layout: picked.id });
  planner?.invalidate();
  syncPhase();
}

/** 只有明確重新分析／情境切換／主體持續消失，才重新選目標。 */
function startAnalysis({ preserveManual = false } = {}) {
  state.viewPending = false;
  state.items = {};
  state.features = {};
  state.remove = [];
  state.advice = "";
  state.scene = "";
  state.awaitingCustom = false;
  state.progress = "searching";
  if (preserveManual && badge?.locked) {
    stabilizer.forceLock({ layout: state.layout.id });
  } else {
    stabilizer.reset();
    badge?.unlock();
    state.layout = state.baseLayout;
    badge?.setAuto(state.baseLayout.id);
  }
  planner?.invalidate();
  resetSceneMemory();
  syncPhase();
}

/** 移動／縮放只撤銷 READY，不重新選交點。 */
function resumeForView() {
  stabilizer.resumeGuiding();
  state.progress = "resumed";
  state.awaitingCustom = false;
  planner?.invalidate();
  syncPhase();
}

function onPlanDeferred({reason = "moving"} = {}) {
  const changed = !state.viewPending || state.progress !== reason;
  state.viewPending = true;
  state.progress = reason;
  stabilizer.deferObservation();
  planner?.setPlanPaused(false);
  if (changed) syncPhase();
}

function syncPhase() {
  const phase = stabilizer.phase;
  badge?.setPhase(phase);
  el.status.dataset.phase = phase;
  el.status.textContent = {
    searching: "選擇構圖中", guiding: "目標已固定", ready: "✓ 可以拍攝",
  }[phase];
  el.shutter.dataset.ready = String(phase === PLAN_PHASE.READY);
  updateHint(state.items);
  updateLightBar();
  render();
}

/** 區分「有在取樣」與「模型真的回覆了」，不要把網路 log 當成完成判斷。 */
function updateAnalysisStatus(activity) {
  if (!el.analysis) return;
  let text;
  if (!activity.running) {
    text = "等待相機啟動";
  } else if (activity.paused) {
    text = "已暫停，回到畫面後繼續判斷";
  } else {
    const age = Number.isFinite(activity.lastPlanResponseAt)
      ? `${Math.max(0, (performance.now() - activity.lastPlanResponseAt) / 1000).toFixed(1)} 秒前`
      : null;
    if (activity.outcome === "error") {
      text = activity.responseMeta?.fallback
        ? "收到回覆，但分析未完成・正在重試"
        : "判斷暫無回應，正在重試";
    } else if (activity.viewPending || ["moving", "expired"].includes(activity.outcome)) {
      text = activity.deferReason === "expired"
        ? "正在取得最新畫面的判斷"
        : "畫面已移動・正在確認新位置";
      if (age) text += `・回覆 ${age}`;
    } else if (activity.activeKind === "plan") {
      text = age ? `持續判斷中・回覆 ${age}` : "正在判斷畫面…";
    } else if (activity.activeKind === "custom") {
      text = "正在建立構圖方案…";
    } else if (age) {
      text = `持續確認構圖・回覆 ${age}`;
    } else {
      text = "掃描畫面中，等待首次判斷…";
    }
  }
  el.analysis.textContent = text;
  el.analysis.dataset.state = activity.outcome;
}

/** planner 每次送出前都會呼叫這個，取得最新的情境 */
function getPlanContext() {
  // 主角那個位置的框。光線分析要用它算「主體 vs 背景」的亮度比，
  // 否則場地裡一盞強燈就會壓過真正要拍的東西。
  const hero =
    state.layout.slots.find((s) => s.prefer === "hero") ??
    state.layout.slots[0];

  return {
    sessionId: stabilizer.sessionId,
    phase: stabilizer.phase === PLAN_PHASE.SEARCHING ? "searching" : "guiding",
    lastAction: stabilizer.lastAction,
    lastAdvice: state.advice,
    confirming: ["candidate", "ready_pending", "guidance_pending", "lost_pending"].includes(state.progress),
    intent: state.intent.id,
    layouts: layoutsFor(state.intent).map((l) => l.id),
    subjectBox: hero?.box ?? null,
    current: {
      id: state.layout.id,
      name: state.layout.name,
      guide_only: !!state.layout.guideOnly,
      composition: state.layout.composition?.type ?? "",
      orientation: guideOrientation(state.layout),
      slots: state.layout.slots.map((s) => ({
        id: s.id, box: s.box, prefer: s.prefer, label: s.label ?? "",
        anchor: s.anchor ?? null,
        guide: s.guide ?? "",
        item: state.items[s.id] ?? "",
        feature: state.features[s.id] ?? "",
      })),
    },
  };
}

/** 把幾何方向翻成人與 VLM 都不會誤解的畫面方向。 */
function guideOrientation(layout) {
  if (layout.composition?.type !== "diagonal") return "";
  const transform = layout.composition.transform ?? {};
  const reversed = !!transform.mirror !== !!transform.flip_y;
  return reversed ? "右上到左下" : "左上到右下";
}

// ── 情境與鏡頭切換 ──────────────────────────────────

function onIntentChange(intent) {
  state.intent = intent;
  const list = layoutsFor(intent);
  state.baseLayout = list[0];
  state.layout = list[0];
  state.items = {};
  state.light = null;
  planner?.resetLighting();

  badge.layouts = list;
  badge.index = 0;
  badge.locked = false;
  badge._render();

  startAnalysis();
}

async function onCameraSwitch(deviceId) {
  planner?.stop();
  planner?.resetLighting();
  startAnalysis();
  state.light = null;
  hint.set("切換鏡頭…", "info");
  try {
    const res = await camera.switchTo(el.video, deviceId, onCameraLost);
    console.log(`切換完成 ${res.width}x${res.height}`);
    devices.remember(deviceId);
    zoomControl?.configure(camera.zoomInfo());
    resetSceneMemory();
    hint.set("正在看畫面…", "info");
  } catch (err) {
    hint.set("這顆鏡頭打不開", "warn");
    console.error(err);
    // 切換失敗就回到原本能用的鏡頭
    try {
      await camera.start(el.video, onCameraLost);
      zoomControl?.configure(camera.zoomInfo());
      cameraPicker?.setDevices(await devices.list(), camera.currentDevice());
    } catch { /* 真的救不回來就交給 onCameraLost */ }
  } finally {
    planner?.start();
  }
}

function onCameraLost() {
  planner?.stop();
  stabilizer.reset();
  hint?.set("相機中斷了", "warn");
  overlay?.clear();
  el.zoom?.classList.add("hidden");
  el.startScreen.classList.remove("hidden");
  el.error.textContent =
    "相機串流中斷了。常見原因是其他程式搶走相機，" +
    "或頁面在相機開著時被重整。";
  el.error.classList.remove("hidden");
  el.start.disabled = false;
  el.start.textContent = "重新啟動相機";
  el.shutter.disabled = true;
  el.reanalyze.disabled = true;
}

// ── VLM 回來時更新狀態 ──────────────────────────────

function onPlan(plan) {
  state.lastPlanAt = performance.now();
  if (state.awaitingCustom) return true;
  state.viewPending = false;
  const event = stabilizer.ingest(plan);
  state.progress = event.kind;

  if (event.kind === "replan") {
    startAnalysis({ preserveManual: true });
    return false;
  }

  if (event.kind === "locked") {
    const selected = event.plan;
    // 唯一允許 LLM 套用版型／adjust 的入口。GUIDING 回應走不到這裡。
    const base = getLayout(selected.layout) ?? state.baseLayout;
    state.baseLayout = base;
    state.layout = selected.fit === "adjust" ? applyAdjust(base, selected.adjust) : base;
    state.fit = selected.fit ?? "good";
    state.scene = selected.scene ?? "";
    state.remove = selected.remove ?? [];
    state.advice = selected.advice ?? "";
    applyItems(selected.placements);
    badge.setAuto(base.id, state.layout?.adjustment ?? false);
    state.awaitingCustom = !!selected.needs_custom && !badge.locked;
  } else if (event.kind === "guidance" && event.update) {
    state.remove = plan.remove ?? [];
    state.advice = plan.advice ?? "";
  } else if (event.kind === "ready") {
    state.remove = [];
    state.advice = "";
    planner?.setPlanPaused(true);
  } else if (event.kind === "resumed") {
    planner?.invalidate();
  }

  // 手選版型／動態版型第一次辨識後，只填尚未設定的主體與對準部位。
  // 不接受後續輸出改名或換部位；確實換主體應先 lost 再重新分析。
  if (event.kind !== "locked" && stabilizer.phase === PLAN_PHASE.GUIDING && plan.alignment !== "lost") {
    applyItems(plan.placements, true);
  }
  syncPhase();
  return state.awaitingCustom;
}

/** 光線分析回來。獨立路徑，不影響版型 */
function onLight(light) {
  state.light = light;
  updateLightBar();
}

/**
 * 動態版型回來。
 *
 * 這條路徑只在主路徑判定「內建版型都不合用」時才會跑，
 * 而且有冷卻時間，不會每隔幾秒就換一個新版型
 * ——那樣使用者根本來不及照著擺。
 */
function onCustom(res) {
  if (!state.awaitingCustom || badge.locked) return;
  state.awaitingCustom = false;
  const dyn = res?.custom ? toLayout(res.custom) : null;
  if (!dyn) {
    state.progress = "guiding";
    syncPhase();
    return;
  }

  state.layout = dyn;
  state.fit = "custom";
  state.advice = "";
  state.remove = [];
  stabilizer.forceLock({ layout: dyn.id });
  planner?.invalidate();
  state.progress = "guiding";
  badge.setDynamic(dyn.name);

  applyItems(res.placements);
  syncPhase();
}

/** 把 placements 轉成 slot → 物品名稱，只保留目前版型有的位置 */
function applyItems(placements, onlyMissing = false) {
  const valid = new Set(state.layout.slots.map((s) => s.id));
  const items = onlyMissing ? { ...state.items } : {};
  const features = onlyMissing ? { ...state.features } : {};
  for (const p of placements ?? []) {
    if (!valid.has(p.slot)) continue;
    if (!items[p.slot]) items[p.slot] = p.item;
    if (!features[p.slot] && p.feature) features[p.slot] = p.feature;
  }
  state.items = items;
  state.features = features;
}

function updateHint(items) {
  if (!hint) return;
  if (state.viewPending) {
    hint.set(state.progress === "expired"
      ? "沿用固定目標，正在確認最新畫面"
      : "位置已改變，停穩一下確認是否到位", "info");
    return;
  }
  if (stabilizer.phase === PLAN_PHASE.READY) {
    hint.set("構圖完成，可以拍攝", "good");
    return;
  }
  if (state.awaitingCustom) {
    hint.set("正在建立這個場景的固定構圖…", "info");
    return;
  }
  if (stabilizer.phase === PLAN_PHASE.SEARCHING) {
    hint.set(state.progress === "no_subject"
      ? "讓拍攝主體進入鏡頭，再保持一下"
      : "先保持畫面，正在確認構圖方案…", "info");
    return;
  }
  if (state.progress === "lost_pending") {
    hint.set("暫時找不到原主體，請讓它回到畫面", "warn");
    return;
  }
  if (state.progress === "ready_pending") {
    hint.set("已接近目標，保持一下確認構圖…", "info");
    return;
  }
  if (state.progress === "guidance_pending") {
    hint.set("正在確認下一步微調，先保持目前位置", "info");
    return;
  }
  if (state.progress === "resumed") {
    hint.set("視野已改變，沿用固定目標重新確認", "info");
    return;
  }
  // 優先序：該移走什麼 > 構圖建議 > 通用提示
  if (state.remove.length) {
    hint.set(`把${state.remove[0]}移出畫面`, "warn");
  } else if (state.advice) {
    hint.set(state.advice, "info");
  } else if (Object.keys(items).length) {
    hint.set(
      state.layout.guideOnly
        ? "讓主體靠近引導點，沿構圖線保留空間"
        : "把東西移進對應的框裡",
      "info"
    );
  } else {
    hint.set(
      state.intent.id === "portrait"
        ? "讓人物進入鏡頭，也保留有意義的背景"
        : "把要拍的東西放到鏡頭前",
      "info"
    );
  }
}

/**
 * 光線狀態。
 *
 * ────────────────────────────────────────────────
 * 三級顯示，不是「好」與「壞」兩種
 *
 *   good     光線本身很好 → 灰底，只講光從哪來
 *   stylish  有明顯風格   → 紫底，教使用者「怎麼用」這個光
 *   problem  真的看不清楚 → 橘紅底，給現場做得到的動作
 *
 * stylish 這一級是刻意的。夜店的藍光、餐廳的暖黃燈、
 * 黃昏的側逆光，在數字上都像「不理想」，
 * 但那是風格不是缺陷。把它標成警告會很煩，
 * 而且會讓使用者去消滅原本很好看的光。
 * ────────────────────────────────────────────────
 */
function updateLightBar() {
  const l = state.light;

  if (stabilizer.phase === PLAN_PHASE.READY) {
    el.light.textContent = l?.verdict === "problem"
      ? "構圖已完成；拍攝前仍請確認主體亮度"
      : "保持目前構圖，確認清晰後按快門";
    el.light.dataset.level = l?.verdict === "problem" ? "warn" : "good";
    el.light.classList.remove("hidden");
    return;
  }

  if (!l) {
    el.light.textContent = "分析光線中…";
    el.light.dataset.level = "idle";
    el.light.classList.remove("hidden");
    return;
  }

  const envName = LIGHT_TEXT.env[l.env] ?? "";
  const envIcon = LIGHT_TEXT.envIcon[l.env] ?? "";
  const parts = [];
  let level = "good";
  const choosing = stabilizer.phase === PLAN_PHASE.SEARCHING;

  if (l.verdict === "problem") {
    level = "bad";
    parts.push(l.tip || LIGHT_TEXT.issue[l.issue] || "光線需要調整");
    if (!l.tip && l.fill_from !== "none") {
      parts.push(LIGHT_TEXT.fill[l.fill_from]);
    }
  } else if (l.verdict === "stylish") {
    level = "style";
    // 風格要先被指認出來，使用者才知道系統懂他在什麼場合
    parts.push(`${envIcon} ${l.mood || envName}`.trim());
    if (choosing && l.tip) parts.push(l.tip);
  } else {
    // good：不用改，那就說點有用的——光從哪來
    parts.push(
      LIGHT_TEXT.source[l.source] || (envName ? envIcon + " " + envName : "光線良好")
    );
    if (choosing && l.tip) parts.push(l.tip);
  }

  if (choosing && l.shoot_from !== "keep") {
    parts.push(LIGHT_TEXT.shoot[l.shoot_from] ?? "");
  }

  el.light.textContent = parts.filter(Boolean).join("・");
  el.light.dataset.level = level;
  el.light.classList.remove("hidden");
}

// ── 拍照 ────────────────────────────────────────────

function capture() {
  // 預覽使用 object-fit: cover。原始相機影格通常是橫向 4:3，
  // 直式手機上只會看見它中央的一條；以前這裡直接保存完整影格，
  // 因此使用者看到直式構圖，下載後卻變成完全不同的橫式照片。
  // visibleRegion() 和送給 VLM／曝光分析共用同一套裁切算法，
  // 保證「畫面看到的範圍」就是「最後存下來的範圍」。
  const { sx, sy, sw, sh } = visibleRegion(el.video);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw));
  c.height = Math.max(1, Math.round(sh));
  c.getContext("2d").drawImage(
    el.video,
    sx, sy, sw, sh,
    0, 0, c.width, c.height
  );
  c.toBlob((blob) => {
    if (!blob) {
      hint.set("拍照失敗，請再試一次", "warn");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapfit-${Date.now()}.jpg`;
    a.click();
    // iOS/Android 有時要等下載工作真正接手後才能撤銷網址。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    hint.set("已拍照", "good");
  }, "image/jpeg", 0.92);
}

// ── 除錯面板。按 D 切換 ──────────────────────────────

function updateDebug() {
  if (!el.debug || el.debug.classList.contains("hidden")) return;
  const age = state.lastPlanAt
    ? ((performance.now() - state.lastPlanAt) / 1000).toFixed(1) + "s 前"
    : "尚未取得";
  const l = state.light;
  const visible = el.video.videoWidth
    ? visibleRegion(el.video)
    : null;
  const cropFactor = visible
    ? Math.max(
        el.video.videoWidth / visible.sw,
        el.video.videoHeight / visible.sh
      )
    : 1;
  el.debug.textContent = [
    `建置 ${CONFIG.BUILD ?? "?"} · 情境 ${state.intent.name}`,
    `畫布 ${overlay?.w}x${overlay?.h} @${overlay?.dpr}x` +
      (overlay?.runaway ? "  ⚠ 尺寸失控" : ""),
    `重畫 ${overlay?.drawCount} · 尺寸調整 ${overlay?.resizeCount}`,
    `版型 ${state.layout?.id} [${state.fit}]` +
      (state.layout?.dynamic ? " 動態" : "") +
      (badge?.locked ? " 鎖定" : ""),
    `場景 ${state.scene || "—"}`,
    `決策 ${stabilizer.phase} · ${state.progress} · 票 ${stabilizer.snapshot.readyHistory.join(",")}`,
    `指派 ${JSON.stringify(state.items)}`,
    `移除 ${state.remove.join("、") || "—"}`,
    `曝光 ${summarize(planner?.lastExposure)}`,
    `環境 ${l ? `${l.env} [${l.verdict}]${l.issue !== "none" ? " " + l.issue : ""}` : "尚未判斷"}`,
    `光線 ${l ? `來源:${l.source} 補:${l.fill_from} 角度:${l.shoot_from}` : "—"}`,
    `  建議 ${l?.tip || "—"}`,
    `構圖延遲 ${Math.round(planner?.lastPlanLatency ?? 0)}ms · 採用 ${age} · 失敗 ${planner?.failuresByKind?.plan ?? 0}`,
    `收到 ${planner?.stats.responses ?? 0} · 採用 ${planner?.stats.applied ?? 0}` +
      ` · 過期 ${planner?.stats.skip ?? 0} · fallback ${planner?.stats.fallback ?? 0}`,
    `畫面差異 原始 ${planner?.lastFrameDifference?.rawDifference?.toFixed(1) ?? "—"}` +
      ` · 手震補償 ${planner?.lastFrameDifference?.difference?.toFixed(1) ?? "—"}`,
    `光線事件 ${planner?.lightMonitor?.reason || "無"} · 待分析 ${!!planner?.lightMonitor?.pending}`,
    `構圖起始間隔 ${planner?.lastPlanGap == null ? "—" : Math.round(planner.lastPlanGap) + "ms"}` +
      ` · 目標 ${CONFIG.PLAN_INTERVAL_MS}ms · 取樣 ${planner?.stats.scan ?? 0} 次`,
    `呼叫 plan ${planner?.stats.plan} · light ${planner?.stats.light}` +
      ` · custom ${planner?.stats.custom} · 略過 ${planner?.stats.skip}`,
    `相機 ${camera.isAlive() ? "正常" : "已中斷"} · ${devices.count()} 顆`,
    `  video ${el.video.videoWidth}x${el.video.videoHeight} ` +
      `ready=${camera.health.readyState} ` +
      `${camera.health.paused ? "暫停" : "播放中"}`,
    `  畫面裁切 ${cropFactor.toFixed(2)}×` +
      (cropFactor > 1.5 ? "（建議切換其他後鏡頭）" : ""),
    `  track ${camera.health.trackState} 異常 ${camera.health.badTicks}/3`,
  ].join("\n");
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();

  const i = ["1", "2", "3", "4", "5", "6"].indexOf(k);
  if (i >= 0) {
    const list = layoutsFor(state.intent);
    if (list[i]) {
      if (badge) {
        badge.index = i;
        badge.locked = true;
        badge._render();
      }
      onManualPick(list[i]);
    }
    return;
  }

  if (k === "i") intentPicker?.next();
  if (k === "c") cameraPicker?.next();
  if (k === "u") startAnalysis();

  if (k === "m" && overlay) {
    overlay.maskAlpha = overlay.maskAlpha > 0 ? 0 : 0.5;
    render();
  }

  if (k === "d") {
    el.debug?.classList.toggle("hidden");
    clearInterval(debugTimer);
    if (!el.debug?.classList.contains("hidden")) {
      updateDebug();
      debugTimer = setInterval(updateDebug, 500);
    }
  }
});
