# 01 · 架構與資料夾結構

這份文件說明**每一層的意義**，以及**新的檔案該放哪裡**。
如果你不確定某個東西該放哪，答案應該在這裡。

---

## 零、技術選型與理由

| 項目 | 選擇 | 理由 |
| --- | --- | --- |
| 前端 | **純 HTML / CSS / JS**，原生 ES modules | 不需要 Node、不需要 build，搬到樹莓派用複製的就好 |
| 後端 | FastAPI + venv | 純 Python 環境，PyCharm 原生支援 |
| 伺服 | **FastAPI 同時提供 API 與靜態網站** | 同源，沒有 CORS 問題，Tunnel 只要開一條 |
| 物件偵測 | TensorFlow.js + COCO-SSD（`<script>` 載入） | 瀏覽器內跑，認得 80 種常見物件 |
| VLM | 國網 `gemma-4-26B-A4B-it`（OpenAI 相容） | 既有經驗，零學習成本 |

**沒有打包工具是刻意的決定。** 我們自己的程式碼用瀏覽器原生的
`import` 拆檔案，分層架構完全保留，只是不經過編譯。

代價是 TF.js 這種第三方函式庫要用 `<script>` 標籤載入，
沒辦法 `import`。這可以接受，因為只有兩個。

---

## 一、系統全貌

```
┌──────────────────────────────────────────────────────────┐
│  手機瀏覽器                                                │
│                                                          │
│   相機串流                                                 │
│      │                                                   │
│      ├──→ 【快層】每 100ms，全部在本機                       │
│      │     物件偵測 → 版型指派（規則） → 對齊偏差計算          │
│      │            │                                      │
│      │            ↓                                      │
│      │      疊層畫面（目標框 / 箭頭 / 對齊變綠）              │
│      │      語音提示（播放預錄音檔，零延遲）                   │
│      │                                                   │
│      └──→ 【慢層】每 1.5 秒，POST /api/plan                │
│                   │                                      │
└───────────────────┼──────────────────────────────────────┘
                    ↓
        ┌───────────────────────────────────┐
        │  FastAPI（同一個 port）             │
        │                                   │
        │  /api/plan  → 驗證 → VLM → 防呆     │
        │  /          → 掛載 web/ 靜態檔案    │
        │                                   │
        │  Provider Chain:                  │
        │    國網 → GMI → OpenAI             │
        └───────────────────────────────────┘
```

**唯一要記住的原則：**
快層永遠不出門，慢層才出門。畫面的流暢度只依賴快層。

---

## 二、完整資料夾結構

```
snapfit/
├── README.md
├── requirements.txt                   ← pip 依賴
├── .env.example
├── .gitignore
├── .venv/                             ← 虛擬環境（不進版控）
│
├── docs/
│   ├── 01-ARCHITECTURE.md
│   ├── 02-ROADMAP.md
│   ├── 03-TODO.md
│   ├── 04-BACKLOG.md
│   └── 05-DECISIONS.md
│
├── web/                               ← 前端：純靜態，無 build
│   ├── index.html
│   ├── css/
│   │   └── app.css
│   ├── img/
│   └── js/
│       ├── main.js                    ← 進入點
│       │
│       ├── vendor/                    ← 第三方函式庫本機副本
│       │   ├── tf.min.js
│       │   └── coco-ssd.min.js
│       │
│       ├── state/
│       │   └── sessionMachine.js
│       │
│       ├── camera/
│       │   ├── camera.js
│       │   └── frameLoop.js
│       │
│       ├── vision/                    ← 快層：本機視覺
│       │   ├── detector.js
│       │   ├── quality.js
│       │   └── alignment.js
│       │
│       ├── layouts/                   ← ★ 專案核心資產
│       │   ├── index.js
│       │   ├── schema.js
│       │   ├── assign.js
│       │   └── definitions/
│       │       ├── single.js
│       │       ├── heroProps.js
│       │       ├── flatlay.js
│       │       └── detail.js
│       │
│       ├── planner/                   ← 規則與 AI 的協調層
│       │   ├── index.js
│       │   ├── rulePlanner.js
│       │   ├── remotePlanner.js
│       │   └── merge.js
│       │
│       ├── guidance/                  ← 偏差 → 人話 → 語音
│       │   ├── phrases.js
│       │   ├── voice.js
│       │   └── toInstruction.js
│       │
│       ├── ui/
│       │   ├── cameraView.js
│       │   ├── overlayCanvas.js
│       │   ├── hintBar.js
│       │   ├── shutterButton.js
│       │   ├── layoutBadge.js
│       │   └── resultCompare.js
│       │
│       └── lib/
│           ├── api.js
│           ├── geometry.js
│           └── config.js
│
├── server/                            ← 後端
│   ├── __init__.py
│   ├── main.py                        ← 進入點，同時掛載 web/
│   ├── config.py
│   │
│   ├── routers/
│   │   ├── plan.py
│   │   ├── advice.py
│   │   ├── listing.py
│   │   └── voice.py
│   │
│   ├── services/
│   │   ├── vlm/
│   │   │   ├── base.py
│   │   │   ├── nchc.py
│   │   │   ├── gmi.py
│   │   │   └── openai_provider.py
│   │   ├── chain.py
│   │   ├── prompts.py
│   │   ├── validate.py
│   │   └── tts.py
│   │
│   └── models/
│       └── schemas.py
│
├── assets/
│   └── voice/                         ← 預先產生的語音檔
│
└── scripts/
    ├── scaffold.py                    ← 建立骨架（跨平台）
    ├── fetch_vendor.py                ← 下載 TF.js 本機副本
    ├── bench_vlm.py                   ← 測延遲
    └── pregen_voice.py                ← 批次產生語音
```

---

## 三、環境設定

### Windows / PyCharm

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python scripts\scaffold.py
```

**PyCharm 設定：**

1. `File → Settings → Project → Python Interpreter`
   選 `Existing environment`，指到 `.venv\Scripts\python.exe`
2. 新增 Run Configuration，類型選 Python：
   - Module name: `uvicorn`
   - Parameters: `server.main:app --reload --host 0.0.0.0 --port 8000`
   - Working directory: 專案根目錄
3. `web/` 不需要特別設定，PyCharm 會自動辨識 HTML/JS

**開發時的網址：** `http://localhost:8000`
前後端同一個 port，不會有跨來源問題。

### 樹莓派

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

**因為前端沒有 build 步驟，整個專案直接 rsync 過去就能跑。**
這是選擇不用打包工具最實際的好處。

---

## 四、逐層說明

### `web/js/camera/` — 取得畫面

| 檔案 | 做什麼 |
| --- | --- |
| `camera.js` | 呼叫 `getUserMedia`，指定後鏡頭，處理權限被拒 |
| `frameLoop.js` | 用 `requestAnimationFrame` 抽幀，**節流到 10fps** |

**相機必須在 HTTPS 下才能開啟。** 這是要用 Cloudflare Tunnel 的原因。
本機開發時 `localhost` 是例外，不需要 HTTPS。

---

### `web/js/vision/` — 快層視覺（本機，不出門）

| 檔案 | 做什麼 |
| --- | --- |
| `detector.js` | 呼叫 COCO-SSD，回傳物件框清單 |
| `quality.js` | 純 canvas 計算：亮度、模糊、水平傾斜 |
| `alignment.js` | 比較實際框與目標框，算出偏差方向與距離 |

**這一層絕對不能有網路呼叫。**

`detector.js` 回傳的每個物件除了框，要附上兩個衍生數值：

- `h_ratio` — 高度佔畫面比例（決定誰放後面）
- `area` — 面積佔畫面比例（決定誰是主角）

**注意：** TF.js 是用 `<script>` 載入的，掛在全域的 `window.cocoSsd`。
在 `detector.js` 裡直接取用，不要試著 `import`。

---

### `web/js/layouts/` — ★ 專案核心資產

**整個專案最有價值的部分，也是唯一完全不依賴外部服務的部分。**

| 檔案 | 做什麼 |
| --- | --- |
| `schema.js` | 定義版型的資料結構 |
| `definitions/*.js` | 四個版型的實際座標，**純資料** |
| `assign.js` | 規則指派：高放後、低放前、大的當主角 |
| `index.js` | 版型註冊表 |

**版型的資料結構：**

```js
export const heroProps = {
  id: "hero_props",
  name: "主角加配件",
  intents: ["secondhand_listing"],
  slots: [
    { id: "back",  box: [0.15, 0.18, 0.55, 0.45], depth: 0, prefer: "tall_or_large" },
    { id: "main",  box: [0.22, 0.38, 0.62, 0.82], depth: 1, prefer: "hero" },
    { id: "front", box: [0.64, 0.60, 0.86, 0.80], depth: 2, prefer: "short_or_small" }
  ]
};
```

- `box` 是 `[x1, y1, x2, y2]`，**一律 0 到 1 的比例**，不是像素
- `depth` 越大越靠前（實現「高放後、低放前」）
- `slots` 至少要有一個 `prefer: "hero"`

**為什麼用比例？** 每支手機螢幕尺寸不同，用像素會亂掉。
Demo 時評審用自己的手機，這件事一定會遇到。

---

### `web/js/planner/` — 規則與 AI 的協調層

| 檔案 | 做什麼 |
| --- | --- |
| `rulePlanner.js` | 純規則，本機，**零延遲** |
| `remotePlanner.js` | 呼叫 `/api/plan` 拿 VLM 修正 |
| `merge.js` | 合併兩者，**平滑過渡** |
| `index.js` | 統一介面 + 模式切換 |

**執行順序：**

1. 偵測到物件 → `rulePlanner` 立刻出計畫 → 畫面馬上有框
2. 背景送請求 → 約 1.5 秒後 `remotePlanner` 回來
3. `merge` 用動畫過渡

**三種模式（用隱藏開關切換）：**

| 模式 | 行為 | 用途 |
| --- | --- | --- |
| `rule` | 只跑規則，完全離線 | **Demo 保命模式** |
| `hybrid` | 規則先跑，AI 後修正 | 正式模式 |
| `remote` | 只等 AI | 開發時測 AI 品質 |

**這個開關一定要做。** 會場網路炸掉時切到 `rule`，Demo 照樣能演。

---

### `web/js/guidance/` — 把數字翻譯成人話

| 檔案 | 做什麼 |
| --- | --- |
| `toInstruction.js` | 偏差 → 指令列舉（`move_left` / `move_closer` / `ok`） |
| `phrases.js` | 列舉 → 中文字串。**所有文案集中在這裡** |
| `voice.js` | 播放 `assets/voice/` 的預錄音檔，含排隊與去重 |

`voice.js` 要處理兩件事：**排隊**（不要兩句同時播）與
**去重**（同一句 3 秒內不重播，不然很吵）。

---

### `server/` — 後端

後端只做一件事：**把請求轉給 VLM，回來的東西檢查過再吐出去。**

| 路徑 | 做什麼 |
| --- | --- |
| `main.py` | 進入點。**掛載順序：`/api` 路由要在 StaticFiles 之前** |
| `routers/plan.py` | 主路徑，回傳版型指派 |
| `routers/advice.py` | 輔助路徑，人話解釋（不擋主流程） |
| `routers/listing.py` | 生成商品標題與描述 |
| `services/chain.py` | Provider 串接與 fallback |
| `services/prompts.py` | 所有提示詞集中管理 |
| `services/validate.py` | 防呆，見下方 |

**`chain.py` 的行為：**

```
國網 (2.5s timeout) → 失敗 → GMI → 失敗 → OpenAI → 全失敗 → 回傳 null
```

前端拿到 `null` 就繼續用規則版型，**不報錯、不中斷**。

**`main.py` 的掛載順序很重要：**
`StaticFiles` 掛在 `/`，會吃掉所有路徑。
所以 API 路由一定要先 `include_router`，靜態檔案最後才 `mount`。

---

## 五、兩個介面（定死，不要改）

### 前端 → 後端

```json
POST /api/plan
{
  "image": "<base64 JPEG，長邊壓到 512>",
  "detections": [
    { "id": "d1", "label": "bottle", "box": [0.12,0.30,0.28,0.72],
      "h_ratio": 0.42, "area": 0.11 },
    { "id": "d2", "label": "book", "box": [0.55,0.40,0.90,0.80],
      "h_ratio": 0.28, "area": 0.19 },
    { "id": "d3", "label": "cable", "box": [0.02,0.85,0.35,0.98],
      "h_ratio": 0.06, "area": 0.03 }
  ],
  "layouts": ["single","hero_props","flatlay","detail"],
  "intent": "secondhand_listing"
}
```

**送出去的圖長邊壓到 512。** VLM 不需要高解析度判斷擺位，
高解析度只會拖慢推論。

### 後端 → 前端

```json
{
  "plan_id": "p_a1b2",
  "layout": "hero_props",
  "assign": { "back": "d2", "main": "d1", "front": null },
  "remove": ["d3"],
  "light": "ok",
  "angle": "too_high",
  "ttl_ms": 4000
}
```

**設計要點：**

- `light` / `angle` 用**列舉值**不用句子
  （`ok` / `too_dark` / `backlit` / `too_high` / `too_low`）
  前端拿列舉值去 `phrases.js` 查中文，模型只吐幾個 token
- `remove` 只給 id，理由是 `/api/advice` 的事
- **完全沒有座標。** 座標來自版型，不是模型

---

## 六、`validate.py` 的四道關卡

**回傳前一律過這四關：**

1. **版型存在** — `layout` 必須在允許清單裡
2. **id 有效** — `assign` 和 `remove` 的 id 必須來自這次的 `detections`
3. **不重複指派** — 同一物件不能出現在兩個 slot
4. **不衝突** — 同一物件不能既被指派又被要求移除

**任何一關不過，退回上一個有效計畫。** 不報錯，靜默降級。

這關不做，Demo 當天會出現框飛掉或物件消失，那是最傷的時刻。

---

## 七、新東西該放哪（速查）

| 你想加的東西 | 放這裡 |
| --- | --- |
| 一個新的構圖版型 | `web/js/layouts/definitions/` |
| 一句新的提示語 | `web/js/guidance/phrases.js` |
| 一個新的畫面元件 | `web/js/ui/` |
| 一個新的 AI 供應商 | `server/services/vlm/` |
| 一個新的 API 端點 | `server/routers/` |
| 純數學計算（框、距離） | `web/js/lib/geometry.js` |
| 第三方 JS 函式庫 | `web/js/vendor/` + `index.html` 的 script 標籤 |
| 一次性工具腳本 | `scripts/` |
| 新的 pip 套件 | `requirements.txt` |
