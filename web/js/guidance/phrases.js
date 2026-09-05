/**
 * 所有給使用者看的文案集中在這裡。
 *
 * 好處：改字不用動邏輯，也方便之後對應到預錄的語音檔。
 */

/** 光線相關的中文對照 */
export const LIGHT_TEXT = {
  /**
   * 環境類型。
   *
   * 有些環境本身就是風格，不是缺陷——
   * 夜店的藍光、餐廳的暖黃燈、黃昏的側逆光，
   * 在數字上都會被判成「不理想」，但那是它們該有的樣子。
   */
  env: {
    daylight_indoor: "室內自然光",
    daylight_outdoor: "戶外日光",
    golden_hour: "黃昏暖光",
    overcast: "陰天散射光",
    warm_indoor: "室內暖黃燈",
    cool_indoor: "室內白光",
    neon: "霓虹彩光",
    lowlight: "昏暗環境",
    mixed: "混合光源",
    unknown: "",
  },

  /** 環境對應的圖示，讓風格看起來像特色而不是警告 */
  envIcon: {
    daylight_indoor: "🪟",
    daylight_outdoor: "☀️",
    golden_hour: "🌇",
    overcast: "☁️",
    warm_indoor: "🕯️",
    cool_indoor: "💡",
    neon: "🌃",
    lowlight: "🌙",
    mixed: "🎨",
    unknown: "",
  },

  issue: {
    none: "",
    too_dark: "光線不足",
    too_bright: "過曝了",
    backlit: "背光，主體太暗",
    harsh: "光太硬，陰影很重",
    flat: "光太平，沒有立體感",
  },
  fill: {
    left: "從左邊補光",
    right: "從右邊補光",
    front: "從正面補光",
    top: "從上方補光",
    none: "",
  },
  shoot: {
    overhead: "改成俯拍",
    high_45: "改成斜 45 度",
    eye_level: "改成平視",
    low: "壓低一點拍",
    keep: "",
  },
  source: {
    left: "光從左邊來",
    right: "光從右邊來",
    top: "光從上方來",
    front: "光從正面來",
    back: "光從背後來",
    mixed: "光源混雜",
    unknown: "",
  },
};

/** 移動引導。之後接語音時，這些是要預錄的固定句 */
export const MOVE_TEXT = {
  move_left: "往左一點",
  move_right: "往右一點",
  move_up: "往上一點",
  move_down: "往下一點",
  move_closer: "再靠近一點",
  move_back: "退後一點",
  ok: "好，停",
};
