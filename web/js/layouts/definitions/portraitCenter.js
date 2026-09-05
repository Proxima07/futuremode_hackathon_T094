import { PREFER } from "../schema.js";

/**
 * 對稱環境人像。
 *
 * 適合走廊、門框、樓梯、建築立面等本身具有中軸或左右對稱的背景。
 * 人物放在中軸，環境的線條負責把視線引向人物。
 */
export const portraitCenter = {
  id: "portrait_center",
  name: "對稱人像",
  hint: "人物置中，利用環境對稱線集中視線",
  minObjects: 1,
  maxObjects: 1,
  guideOnly: true,
  composition: { type: "portrait_center" },
  slots: [
    {
      id: "person",
      box: [0.25, 0.12, 0.75, 0.76],
      anchor: [0.50, 0.29],
      depth: 0,
      prefer: PREFER.HERO,
      label: "眼睛靠中線",
    },
  ],
};
