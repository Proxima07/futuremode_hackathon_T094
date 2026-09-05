# 03 · 待辦清單

標記說明：
🔴 **阻塞** — 沒做完後面全卡住
🟡 **主線** — 產品成立的必要條件
🟢 **加分** — 有時間才做

---

## Phase 0 · 地基（9/4 晚）

### 環境驗證

- [ ] 🔴 從**非校內網路**用 curl 打國網 API，確認能回應
- [ ] 🔴 送一張圖給 `gemma-4-26B-A4B-it`，確認多模態輸入格式正確
- [ ] 🔴 跑 10 次測延遲，記錄中位數與 P90
- [ ] 🟡 測 `response_format: json_object` 支不支援
- [ ] 🟡 順手測 `Microsoft-Phi-4-multimodal-instruct` 延遲（可能快很多）
- [ ] 🟢 測 `gemma-4-31B-it` 當備援

### 版型資料

- [ ] 🔴 設計 `single`（單品主體）座標
- [ ] 🔴 設計 `hero_props`（主角加配件）座標
- [ ] 🟡 設計 `flatlay`（平拍排列）座標
- [ ] 🟡 設計 `detail`（細節特寫）座標
- [ ] 🔴 寫 `schema.js` 定義資料結構
- [ ] 🔴 寫 `assign.js` 規則指派邏輯

### 骨架

- [ ] 🔴 `bash scripts/scaffold.sh` 建立目錄
- [ ] 🔴 Vite + React 起得來
- [ ] 🔴 FastAPI 起得來
- [ ] 🔴 Cloudflare Tunnel 通，手機能連
- [ ] 🔴 手機瀏覽器能開相機看到畫面
- [ ] 🟡 `.env.example` 寫好

---

## Phase 1 · 離線可用（9/5 上午）

### 相機與偵測

- [ ] 🔴 `useCamera.js` 指定後鏡頭
- [ ] 🔴 `useFrameLoop.js` 節流到 10fps
- [ ] 🔴 `detector.js` 載入 COCO-SSD
- [ ] 🔴 偵測結果附上 `h_ratio` 與 `area`
- [ ] 🟡 偵測框做時間平滑，減少抖動
- [ ] 🟢 `quality.js` 亮度與模糊判斷

### 版型與指派

- [ ] 🔴 `rulePlanner.js` 依物件數量挑版型
- [ ] 🔴 依高度排序指派 slot（高放後、低放前）
- [ ] 🔴 依面積挑出主角
- [ ] 🟡 `LayoutBadge.jsx` 顯示目前版型，可手動切換

### 畫面

- [ ] 🔴 `OverlayCanvas.jsx` 畫出目標框
- [ ] 🔴 `alignment.js` 算出偏差
- [ ] 🔴 對齊時框變綠
- [ ] 🟡 畫出箭頭指示移動方向
- [ ] 🔴 `ShutterButton.jsx` 對齊時才能按
- [ ] 🔴 拍照能存下影像

### 這一階段的成功定義

> 拔掉網路線，整個流程從頭到尾能跑完。

---

## Phase 2 · 接上 AI（9/5 下午）

### 後端

- [ ] 🔴 `schemas.py` 定義請求與回應
- [ ] 🔴 `nchc.py` 國網 provider（OpenAI 相容）
- [ ] 🔴 `prompts.py` 主路徑 system prompt
- [ ] 🔴 `plan.py` 端點跑通
- [ ] 🔴 `validate.py` 四道防呆
- [ ] 🔴 JSON 清洗（去除 markdown 圍欄）
- [ ] 🟡 `chain.py` fallback：國網 → GMI → OpenAI
- [ ] 🟡 timeout 設 2500ms
- [ ] 🟢 `gmi.py` provider
- [ ] 🟢 `advice.py` 輔助路徑

### 前端

- [ ] 🔴 `remotePlanner.js` 呼叫後端
- [ ] 🔴 圖片壓到長邊 512 再送
- [ ] 🔴 `merge.js` 平滑過渡
- [ ] 🔴 三種模式的隱藏切換開關
- [ ] 🟡 AI 失敗時靜默降級，不顯示錯誤
- [ ] 🟡 節流：1.5 秒最多送一次

### 這一階段的成功定義

> 拔掉網路，產品依然完整可用，只是變笨。

---

## Phase 3 · 體驗（9/5 晚）

### 優先序由高到低

- [ ] 🔴 `ResultCompare.jsx` 前後並排對比 ← **最高優先**
- [ ] 🟡 `phrases.js` 列出 30 到 50 句提示語
- [ ] 🟡 `pregen_voice.py` 批次產生語音檔
- [ ] 🟡 `voice.js` 播放、排隊、去重（3 秒內不重播）
- [ ] 🟡 `listing.py` 生成商品標題與描述
- [ ] 🟢 UI 收尾與動畫
- [ ] 🟢 一鍵複製商品文案

---

## Phase 4 · 收尾（9/6 上午）

- [ ] 🔴 錄 60 秒備援影片，**存本機**
- [ ] 🔴 Demo 腳本排練 3 次
- [ ] 🔴 用**別人的手機**完整測一次
- [ ] 🔴 開飛航模式測 `rule` 模式
- [ ] 🔴 QR code 印出來
- [ ] 🔴 準備 Demo 道具
- [ ] 🔴 **11:00 前提交**
- [ ] 🟡 README 補上截圖
- [ ] 🟡 準備「跟現有 App 差在哪」的回答

---

## 一定要記得的三件事

1. **明早第一件事測延遲**，不是寫程式
2. **Phase 1 結束前不要碰 AI**，先讓流程順
3. **超時 50% 就砍範圍**，不要硬撐
