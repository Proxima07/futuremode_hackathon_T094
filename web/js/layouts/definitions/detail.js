import { PREFER } from "../schema.js";

/**
 * 細節特寫。
 *
 * 拍瑕疵、材質、序號、磨損。
 *
 * 二手交易一定要有這種照片，它是糾紛的主要來源：
 * 買家說沒講清楚，賣家說有拍。所以這個版型不是可有可無的裝飾，
 * 是二手場景的必要功能。
 *
 * 設計考量：
 *   - 單一大框，佔畫面約 80% x 64%
 *   - 框大代表「靠近一點」，引導使用者把手機貼近物件
 *   - 上下留白比左右多，因為特寫時手容易入鏡
 */
export const detail = {
  id: "detail",
  name: "細節特寫",
  hint: "拍瑕疵、材質或序號時使用",
  minObjects: 1,
  maxObjects: 1,
  slots: [
    {
      id: "detail",
      box: [0.09, 0.18, 0.91, 0.72],
      depth: 0,
      prefer: PREFER.HERO,
      label: "把細節填滿這個框",
    },
  ],
};
