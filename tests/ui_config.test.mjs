/** 介面開關：後端可覆寫，抓不到就用預設值，不能因此擋住啟動。 */
import test from "node:test";
import assert from "node:assert/strict";
import { UI, applyUiConfig } from "../web/js/lib/config.js";

test("後端的布林值會覆寫預設", () => {
  applyUiConfig({ showAnalysisStatus: false, allowDebugPanel: false });
  assert.equal(UI.showAnalysisStatus, false);
  assert.equal(UI.allowDebugPanel, false);
  applyUiConfig({ showAnalysisStatus: true, allowDebugPanel: true });
});

test("非布林值與未知欄位一律忽略", () => {
  const before = { ...UI };
  applyUiConfig({ showAnalysisStatus: "false", pinchZoom: 1, 亂寫: true });
  assert.deepEqual({ ...UI }, before, "字串 false 不該被當成 false");
});

test("null 或壞掉的回應不會弄壞開關", () => {
  const before = { ...UI };
  applyUiConfig(null);
  applyUiConfig("壞掉的回應");
  assert.deepEqual({ ...UI }, before);
});
