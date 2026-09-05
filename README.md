# SnapFit

**別的相機 App 教你怎麼拍，SnapFit 告訴你東西該怎麼擺。**

FUTUREMODE 2026 台灣未來祭黑客松 · Track 02 日常生活 AI · 隊伍 T094(馬內歸我)

---

## 問題與目標

大部分人拍不好照片，不是因為手機不夠好，是因為**不知道東西該放哪裡**。

構圖的規則其實講得清楚：主體佔多大、放哪個位置、高的東西該不該擋住矮的、
光從哪邊來比較好看。但這些知識散在攝影教學裡，
一般人不會為了拍一張二手商品照或一盤晚餐去學。

現有的 AI 相機工具幾乎都在做同一件事：**分析已經拍好的照片，然後給評分或建議**。
問題是那時候東西已經收起來了，沒有人會為了一個分數重新擺一次。

SnapFit 反過來做：**在按下快門之前，直接在畫面上畫出東西該擺的位置，
並告訴使用者現在該往哪個方向移動。**

- **目標使用者**：想把商品拍得賣得掉的二手賣家、想把餐點拍好看的一般人、
  需要拍情境照的小商家。
- **預期影響**：把「需要學習的攝影知識」變成「照著框擺就好的動作」。
  使用者不必理解三分法或黃金螺旋，只需要把東西移進框裡。

---

## 核心功能

- **即時構圖引導**
  VLM 持續判讀畫面，從 13 種版型中選出最合適的一種，
  在螢幕上畫出目標框與構圖輔助線（三分線、黃金格、黃金螺旋、三角、對角線），
  並用中文標出每個位置該放什麼——顯示「白色滑鼠」而不是「主商品」。

- **鎖定目標，一次只給一個動作**
  選定構圖後就把版型、方向、對準部位固定住，
  不會因為使用者靠近一點就把目標移走。到位後顯示「可以拍攝」。

- **環境感知的光線建議**
  先判斷這是什麼環境（霓虹、暖黃燈、黃昏、昏暗⋯共十種），再決定要不要修。
  夜店的藍光是**風格**不是缺陷，這時教使用者怎麼用這個光；
  真的太暗才建議補光，而且是現場做得到的動作
  （「用另一支手機的手電筒照」而不是「請使用專業補光設備」）。

- **四種拍攝情境**
  美食、二手商品、商品情境、環境人像。
  每種情境有各自的可用版型與攝影慣例，切換後判斷邏輯跟著換。

- **動態版型生成**
  內建版型都不合用時，讓 VLM 現場設計一組引導框，
  後端會做座標修正、重疊過濾與主角檢查後才送出。

- **相機控制**
  多鏡頭切換、兩指縮放、串流中斷自動復原。

---

## 系統架構

```
┌──────────────────────── 手機瀏覽器 ────────────────────────┐
│                                                            │
│  相機串流（多鏡頭切換 / 兩指縮放 / 串流看門狗）                │
│      │                                                     │
│      ├── 本機層 · 零延遲 ──────────────────────────┐        │
│      │   exposure.js      亮度、反差、色溫、飽和、色相 │        │
│      │   frameFreshness   32×32 指紋比對，容忍手震     │        │
│      │   overlayCanvas    構圖線 + 目標框 + 暗化遮罩    │        │
│      │   planStabilizer   多幀共識，決定何時鎖定與放行  │        │
│      └───────────────────────────────────────────┘        │
│      │                                                     │
│      └── 遠端層 · 三條路徑，各有節奏 ──────────────┐        │
│          plan    約每秒一次，且畫面要有變化才送       │        │
│          light   由光線變化觸發，最短間隔 15 秒       │        │
│          custom  內建版型都不合用時，冷卻 15 秒       │        │
└──────────────────┼─────────────────────────────────┘        │
                   ↓  HTTPS（Cloudflare Tunnel）
    ┌──────────────────────────────────────────┐
    │  FastAPI（單一 port，同時服務 API 與靜態）   │
    │                                           │
    │  /api/plan       版型判斷 + 物品配置        │
    │  /api/light      環境判斷 + 光線建議        │
    │  /api/custom     動態版型生成               │
    │  /api/ui-config  介面開關（讀 .env）        │
    │  /               掛載 web/ 靜態檔案         │
    │                                           │
    │  validate.py     驗證與修正模型輸出         │
    │  chain.py        Provider 降級              │
    └───────────────────┬──────────────────────┘
                        ↓
      國網中心 gemma-4-26B-A4B-it
        └─ 失敗 → GMI Cloud → OpenAI → 回傳 fallback（畫面維持現狀）
```
### 部屬方案
配置在樹梅派上，該樹梅派裝有中華電信家用網路實體連線。
透過 Cloudflare tunnel 進行流量轉接，並將網域所有權保持在Cloudflare上，添加CNAME的紀錄 已進行流量轉址。

### 各層怎麼協作

**本機層負責即時，遠端層負責語意。** 這是整個系統的核心分工。

畫面上的框、輔助線、對齊狀態全部在本機重畫，不等網路。
`exposure.js` 每秒算一次亮度與顏色統計，那是純數學，又快又準。

VLM 負責本機算不出來的事：這是什麼物品、哪個是主角、
這個環境是霓虹還是暖黃燈、現在該往哪個方向移動。

**曝光數字會連同影像一起送給 VLM。**
模型對「絕對亮度」沒有參照基準——實測過純白的過曝畫面它也回答「沒問題」——
但拿到客觀數字之後，就能做出正確的方向性判斷。

**多幀共識由程式保證，不交給模型。**
同一個版型要連續兩次提案才鎖定；
「可以拍攝」要最近三次判斷中有兩次 `ready`；
新的移動方向要連續兩次確認才替換提示。
LLM 只負責提案與判斷，收斂規則由程式決定。

**沒有資料庫。** 照片不上傳、不儲存，全部在瀏覽器記憶體處理完就結束。
送給模型的影像壓到長邊 512，而且只送使用者實際看得到的範圍
（`object-fit: cover` 裁掉的部分不送，否則模型會分析到螢幕上沒有的東西）。

### 失效時的行為

每一層都能單獨失效而不拖垮下一層：

| 失效點 | 結果 |
| --- | --- |
| 畫面沒變化 | 不送請求，畫面維持現狀 |
| VLM 逾時或掛掉 | 回 `fallback`，沿用目前的構圖目標 |
| 模型輸出格式不對 | 驗證層拒絕，沿用上一個有效結果 |
| 動態版型不合格 | 先修座標；修不動才退回內建版型 |
| 個別欄位有問題 | 只丟那一項，其餘照常 |
| 相機串流中斷 | 看門狗自動嘗試復原兩次，失敗才顯示錯誤 |

**沒有任何路徑會讓畫面變成錯誤訊息或空白。** 最壞的情況是維持現狀。

---

## 使用技術

| 類型 | 技術／服務 | 用途 |
| --- | --- | --- |
| AI 模型 | 國網中心 `gemma-4-26B-A4B-it` | 主力視覺語言模型。判斷版型、物品配置、環境與光線 |
| AI 模型 | `Microsoft-Phi-4-multimodal-instruct` | 備選的輕量模型，可透過 `.env` 切換 |
| 前端 | 原生 HTML / CSS / JavaScript（ES modules） | 不使用框架與打包工具，零 build 步驟 |
| 前端 | Canvas 2D | 構圖輔助線、目標框、暗化遮罩 |
| 前端 | MediaDevices API | 相機串流、多鏡頭列舉、`applyConstraints` 光學變焦 |
| 後端 | FastAPI + Uvicorn | API 與靜態檔案由同一個 port 服務，前後端同源 |
| 後端 | Pydantic | 前後端契約定義與型別驗證 |
| 後端 | OpenAI Python SDK | 國網為 OpenAI 相容端點，三家 Provider 共用同一份實作 |
| 後端 | Pillow | 影像壓縮 |
| Sponsor 技術 | **GMI Cloud** | Provider 降級鏈的第二層，國網逾時或失敗時自動接手 |
| 部署 | Cloudflare Tunnel | 提供 HTTPS。瀏覽器規定相機只能在安全來源下啟用 |
| 測試 | Node.js `node:test`、pytest | 86 項 JavaScript 測試、13 項 Python 契約測試 |

---

## 安裝與執行

### 需求

- Python 3.10 以上
- 一組和 OpenAI 相容端點 的 API 金鑰


### 步驟

```bash
# 1. 取得程式碼
git clone https://github.com/Proxima07/futuremode_hackathon_T094.git
cd futuremode_hackathon_T094

# 2. 建立虛擬環境並安裝依賴
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 3. 設定金鑰
cp .env.example .env               # Windows: copy .env.example .env
#    編輯 .env，至少要填這三行：
#      NCHC_BASE_URL=https://portal.genai.nchc.org.tw/api/v1
#      NCHC_API_KEY=你的金鑰
#      NCHC_MODEL=gemma-4-26B-A4B-it

# 4. 啟動服務
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

開 `http://localhost:8000` 即可在電腦上操作。

### 手機測試（要用相機必須做這一步）

瀏覽器規定 `getUserMedia` 只能在**安全來源**下使用，也就是 HTTPS 或 `localhost`。
`http://192.168.x.x:8000` 這類純 IP 的 HTTP 一律會被拒絕。

**另開一個終端機**（uvicorn 那個不要關）：

```bash
python scripts/tunnel.py
```

它會啟動 Cloudflare Tunnel、取得網址，**直接在終端機印出 QR code**，
用手機掃描即可開啟，同時會存一份 `assets/tunnel-qr.png`。

### 驗證安裝

```bash
python scripts/bench_vlm.py          # 測 VLM 延遲，不需自備照片
python scripts/net_check.py          # 連線與防火牆診斷
python -m pytest tests/ -q           # 後端契約測試
node tests/plan_stabilizer.test.mjs  # 執行單一前端測試檔
```

`bench_vlm.py` 會自行生成測試圖，跑十次並輸出延遲中位數與 P90，
同時檢查模型的 JSON 輸出是否可解析。

### 可調整的介面開關（`.env`）

```bash
SHOW_ANALYSIS_STATUS=false   # 「持續判斷中」狀態列。展示時建議關閉
ALLOW_DEBUG_PANEL=true       # 按 D 開啟除錯面板
PINCH_ZOOM=true              # 兩指縮放；false 會退回畫面上的滑桿
```

改完重啟 uvicorn，前端重新整理即可生效。

---

## 作品展示

- 作品展示網址：https://futuremode_hackathon.aphelion.tw/
- 評選影片：

**操作流程**：開啟頁面 → 允許相機權限 → 按「開始拍攝」→
把要拍的東西放到鏡頭前 → 照著畫面上的框與指示移動 →
顯示「可以拍攝」後按下快門。

左上角切換拍攝情境與鏡頭，右上角可手動指定構圖版型。

---

## 限制與未來工作

### 已知限制

- **光學變焦的支援度依裝置而異。**
  iOS Safari 沒有開放 `zoom` 約束，桌機瀏覽器幾乎都不支援。
  不支援的裝置會自動隱藏縮放介面。

- **模型延遲會隨服務負載變動。**
  開發期間實測過中位數 306ms 到 2 秒以上的差距。
  延遲拉長時系統會自動放慢節奏並沿用現有目標，請求不會堆積，
  但引導的即時感會下降。

- **畫面移動偵測是近似的。**
  32×32 灰階指紋比對容忍約 9% 的整體平移（手震範圍），
  這不是物件追蹤，「是否真的對準」仍由模型判斷。

- **亮度統計不是照度計。**
  它是影像亮度的近似值，會受大面積深色物品與背景變動影響。

- **未在多種機型上完整驗證。**
  開發測試以 Android Chrome 為主，iOS Safari 的相機行為差異較大。

### 未完成項目

- **前後對比**：拍完後把「引導前」與「引導後」並排顯示。程式碼中已預留位置。
- **語音引導**：文案已備妥（`web/js/guidance/phrases.js`），播放與去重邏輯未實作。
- **商品文案生成**：端點與提示詞已設計，尚未接上。

### 後續發展方向
- **瑕疵引導。**
  二手交易最大的糾紛來源是瑕疵沒拍清楚。
  系統可以主動提示「這裡看起來有磨損，建議補一張特寫」。

- **一鍵上架。**
  拍完直接推送到交易平台，含標題、描述與多張照片。

- **物件內偵測**
  食品時常以組合的方式呈現，當今日拍攝物是多種類時該排版才是主要的目標物(ex:食物拼盤)，後續將引入yolo物件辨識先進行物件框選後，再由vlm進行位置排序任務

- **人物辨識**
  本方案當前在拍攝人物照片時，依舊無法有效感知 環境背景、人物動作之間的組合，因此在拍攝人物時無法有效提供建議，後續將透過few shot的樣板來做擴充

- **環境照片**
 本方案目前也缺少 沒有畫面主體時，也就是純環境照下的模板，後續將進一步依照vlm判斷情境並進行擴充(目前規劃將以 全景先拍攝一張，後決定目標區域的方法來做執行)
---

## 第三方服務、資料與素材

| 項目 | 來源 | 授權 / 條款 |
| --- | --- | --- |
| gemma-4-26B-A4B-it | [國網中心生成式 AI 服務平台](https://portal.genai.nchc.org.tw) | 依平台服務條款使用；金鑰未包含於儲存庫 |
| GMI Cloud | [gmicloud.ai](https://www.gmicloud.ai) | 黑客松贊助商提供之額度，作為降級備援 |
| FastAPI | [github.com/fastapi/fastapi](https://github.com/fastapi/fastapi) | MIT |
| Uvicorn | [github.com/encode/uvicorn](https://github.com/encode/uvicorn) | BSD-3-Clause |
| Pydantic | [github.com/pydantic/pydantic](https://github.com/pydantic/pydantic) | MIT |
| OpenAI Python SDK | [github.com/openai/openai-python](https://github.com/openai/openai-python) | Apache-2.0 |
| Pillow | [github.com/python-pillow/Pillow](https://github.com/python-pillow/Pillow) | MIT-CMU |
| python-dotenv | [github.com/theskumar/python-dotenv](https://github.com/theskumar/python-dotenv) | BSD-3-Clause |
| qrcode | [github.com/lincolnloop/python-qrcode](https://github.com/lincolnloop/python-qrcode) | BSD |
| cloudflared | [github.com/cloudflare/cloudflared](https://github.com/cloudflare/cloudflared) | Apache-2.0 |

**素材說明**
本專案未使用任何外部圖片、字型或音訊素材。
介面文字與圖示皆為自行撰寫，13 種構圖版型的座標由團隊自行設計。
`scripts/bench_vlm.py` 使用的測試圖為程式即時生成，非外部素材。

**金鑰與隱私**
所有金鑰透過 `.env` 讀取，該檔案已列入 `.gitignore`，
儲存庫僅提供 `.env.example` 範本，不含任何實際憑證。
系統不儲存使用者照片，影像僅在記憶體中處理後即釋放。

---

## 團隊成員

| 姓名  | 分工              |
|-----|-----------------|
| 孔祥緯 | 系統架構、前後端開發、模型串接與部署 |
| 許祐瑄 | 系統架構、模組測試、樣板規劃  |

---

## License

本專案採用 **MIT License**，完整條款請見儲存庫根目錄的 [`LICENSE`](LICENSE)。
