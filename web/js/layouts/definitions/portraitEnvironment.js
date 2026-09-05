import { PREFER } from "../schema.js";

/**
 * 環境人像。
 *
 * 人物靠近一側三分線，把另外約三分之二留給能交代地點、事件或
 * 視線方向的環境。錨點代表眼睛／臉部重心，不是要求整個人縮成一點。
 */
export const portraitEnvironment = {
  id: "portrait_environment",
  name: "環境人像",
  hint: "眼睛靠近交點，另一側保留能說故事的環境",
  minObjects: 1,
  maxObjects: 1,
  guideOnly: true,
  composition: { type: "portrait_environment" },
  slots: [
    {
      id: "person",
      box: [0.08, 0.14, 0.58, 0.76],
      anchor: [1 / 3, 0.30],
      depth: 0,
      prefer: PREFER.HERO,
      label: "眼睛靠交點",
    },
  ],
};
