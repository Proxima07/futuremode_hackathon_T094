/**
 * 全域設定。
 *
 * 所有「數字」集中在這裡，方便調參數時不用到處找。
 * 尤其是對齊容忍值，那個要靠實際使用才調得出來。
 */

export const CONFIG = {
  /** 版本戳記。console 會印出來，用來確認載入的不是快取的舊檔 */
  BUILD: "v0.32",

  /** 快層迴圈的頻率。10 次/秒足夠流暢，又不會把手機電力燒光 */
  FPS: 10,

  /** 送給 VLM 的影像長邊上限。要和後端的 IMAGE_MAX_EDGE 一致 */
  IMAGE_MAX_EDGE: 512,

  /**
   * 構圖請求的目標起始間隔，SEARCHING / GUIDING / READY 都適用。
   * 從送出時計時；模型若超過一秒才回，立即接續最新畫面，不排隊補送。
   */
  PLAN_INTERVAL_MS: 1000,

  /** 本機小縮圖每 250ms 看一次移動；遠端構圖仍以一秒為目標。 */
  SCAN_INTERVAL_MS: 250,

  /** 每秒只在本機算曝光；首次／明顯且持續的光線變化才送 /api/light。 */
  LIGHT_CHECK_INTERVAL_MS: 1000,
  LIGHT_CHANGE: { confirmations: 3, minIntervalMs: 15000,
    meanDelta: .10, colorDelta: .16, directionDelta: .14, clipDelta: .12 },
  /** 沒有空檔時，至少先完成八次構圖才讓待處理的光線事件插入。 */
  LIGHT_PLAN_BUDGET: 8,
  /** 太舊的照片即使形狀相似也不再套用，避免呈現十秒前的判斷。 */
  PLAN_MAX_FRAME_AGE_MS: 5000,

  /**
   * 動態版型的最短重生間隔。
   * 生成一次很貴，而且生完之後應該讓使用者有時間照著擺，
   * 不要每隔幾秒就換一個新版型。
   */
  CUSTOM_COOLDOWN_MS: 15000,

  /**
   * 構圖收斂條件。LLM 只負責提案與判斷，這些多幀規則由程式保證。
   */
  STABILITY: {
    /** 相同版型與方向出現幾次後才定案 */
    planConfirmations: 2,
    /** 模型意見一直不同時，最多等幾次就以多數／最近結果定案 */
    maxPlanSamples: 3,
    /** 最近視窗中至少幾票 ready 才顯示可以拍攝 */
    readyVotes: 2,
    readyWindow: 3,
    /** 連續幾次判斷主體消失才重新規劃 */
    lostConfirmations: 2,
    /** 新移動方向連續出現幾次才替換目前提示 */
    guidanceConfirmations: 2,
    /** 網路中斷／很慢時，過期證據不能和新影格湊票 */
    evidenceMaxAgeMs: 10000,
    /** 同方向提示隨新結論更新，最多每秒一次；改方向仍需連續確認。 */
    adviceRefreshMs: 1000,
  },

  /**
   * 疊層的暗化強度。
   * 0 = 完全透明，只留框線，對底層影片的干擾最小。
   * 執行時按 M 可以在 0 / 0.5 之間切換來比較。
   */
  MASK_ALPHA: 0.5,

  /**
   * 對齊容忍值。
   * 供舊版本機 alignment 模組使用；目前 RemotePlanner 的完成判定由
   * GUIDING_SYSTEM 的目視容忍規則及 STABILITY 投票控制，不讀這組值。
   *
   * 這兩個數字決定「什麼叫對準了」。
   * 寧可調鬆一點：太嚴格的話使用者永遠對不準，會很挫折。
   */
  ALIGN: {
    /** 中心點偏移容忍，以畫面對角線的比例計 */
    CENTER_TOLERANCE: 0.10,
    /** 大小比例容忍。0.35 代表大小差三成以內都算對 */
    SCALE_TOLERANCE: 0.35,
  },

  /** 同一句語音在這段時間內不重播，避免很吵 */
  VOICE_COOLDOWN_MS: 3000,
};

/**
 * 各種 slot 類型的顏色。
 * 和 layouts-preview.html 保持一致，方便對照。
 */
export const COLORS = {
  hero: "#4ade80",
  tall_or_large: "#60a5fa",
  short_or_small: "#fbbf24",
  any: "#a78bfa",
  /** 對齊成功時整個框變這個顏色 */
  aligned: "#22c55e",
};

/** 執行模式。用隱藏開關切換，Demo 斷網時切到 rule */
export const MODE = {
  /** 只跑規則，完全離線。Demo 保命模式 */
  RULE: "rule",
  /** 規則先跑，AI 後修正。正式模式 */
  HYBRID: "hybrid",
  /** 只等 AI。開發時測 AI 品質用 */
  REMOTE: "remote",
};
