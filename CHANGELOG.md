# 變更紀錄

---

## v0.27 · 2026-09-05 — 新增構圖引導版型

新增三分法、黃金分割、黃金螺旋、三角構圖與對角線構圖。
這五種版型使用分割線、曲線與視覺錨點，不要求物件一定形成前後高低。

LLM 現在會收到每個版型的用途與選擇條件，能依主體數量、留白、
視線流、穩定感與方向感自動選擇。既有 mirror、scale、shift 調整
也會同時作用於構圖線與錨點。

## v0.26 · 2026-09-05 — 修正縮放控制未顯示

Android Chrome 需要在 `getUserMedia()` 明確請求 `zoom: true`，
才會公開鏡頭的縮放能力。現在會先檢查瀏覽器支援的 constraints，
支援時一併請求 Zoom 權限；不支援的瀏覽器則維持一般相機流程。

## v0.25 · 2026-09-05 — 拍照與直式預覽一致、加入相機縮放

### 修正：直式預覽卻存成橫式照片

相機原始影格通常是橫向 4:3，但手機畫面用 `object-fit: cover`
顯示成直式，因此預覽只會顯示原始影格中央的區域。舊版拍照時直接保存
完整原始影格，造成使用者看到的構圖和下載照片不同。

現在拍照、VLM 影像與曝光分析共用 `visibleRegion()`，只保存畫面真正
顯示的裁切範圍。直式預覽會輸出同樣比例的直式照片。

### 新增：相機縮放控制

- 相機啟動時自動回到該鏡頭支援的最小倍率，避免沿用異常放大狀態
- 畫面提供縮小按鈕、倍率滑桿、放大按鈕與即時倍率
- 切換鏡頭後重新取得該鏡頭的縮放能力
- 連續拖曳時只套用最新倍率，避免非同步回應使倍率倒退
- 瀏覽器沒有公開相機縮放能力時自動隱藏控制，不影響拍攝

### 包含檔案

```
web/index.html
web/css/app.css
web/js/camera/camera.js
web/js/ui/zoomControl.js
web/js/main.js
web/js/lib/config.js
CHANGELOG.md
```

## v0.24 · 2026-09-05 — 光線改成「先認環境，再決定要不要修」

### 包含檔案

```
server/models/schemas.py          (改：加入反差與顏色欄位)
server/services/prompts.py        (改：LIGHT_SYSTEM 重寫)
server/services/validate.py       (改：三級判定)
web/js/vision/exposure.js         (改寫：加入顏色與反差統計)
web/js/guidance/phrases.js        (改：環境名稱與圖示)
web/js/main.js                    (改：三級顯示)
web/js/lib/config.js              (改：v0.24)
web/css/app.css                   (改：風格用紫色)
CHANGELOG.md
```

**後端有變動，要重啟 uvicorn。**

### 原本的設計有個根本問題

**只有「正常」和「有問題」兩種答案。**

但夜店的藍光、餐廳的暖黃燈、黃昏的側逆光，
在數字上都會被判定成「太暗」或「色偏」——
可是它們是**風格**，不是缺陷。

把它們標成警告不只是煩，而且會讓使用者
去消滅原本很好看的光。

### 缺口：我只算了亮度，完全沒算顏色

模型要判斷「這是藍光場景」只能用猜的。

`exposure.js` 現在多算兩類數字：

**顏色**

| 欄位 | 意思 |
| --- | --- |
| `warmth` | -1 冷（藍）~ +1 暖（橙） |
| `saturation` | 平均飽和度，高代表有色燈光 |
| `hue_spread` | 色相散布 0~1，高代表多種顏色的光混雜 |
| `dominant_hue` | 主色相 0~360 |

**反差**

`contrast` 是亮度的標準差。高 = 明暗落差大（硬光），
低 = 平光。少了這個，「光太硬」和「光太平」也只能猜。

驗證過能正確分辨：

```
夜店藍光  warmth=-0.739 (冷) 飽和=0.85 色相=229°
餐廳暖黃  warmth=+0.438 (暖) 飽和=0.61 色相=34°
中性白光  warmth=-0.012 (中性) 飽和=0.02
粉紅霓虹  warmth=+0.222 飽和=0.59 色相=337°
```

送給模型時會直接翻成白話：
「明顯偏冷（藍紫）、彩度很高，很可能是有色燈光、主色相偏藍」。

### 新的判斷流程：先認環境

**env** 十種：

```
daylight_indoor  室內自然光      🪟
daylight_outdoor 戶外日光        ☀️
golden_hour      黃昏暖光        🌇
overcast         陰天散射光      ☁️
warm_indoor      室內暖黃燈      🕯️
cool_indoor      室內白光        💡
neon             霓虹彩光        🌃
lowlight         昏暗環境        🌙
mixed            混合光源        🎨
unknown          判斷不出來
```

### verdict 改成三級

| verdict | 意思 | 顯示 |
| --- | --- | --- |
| `good` | 光線本身很好 | 灰底，講光從哪來 |
| `stylish` | **有明顯風格** | **紫底**，教使用者怎麼「用」這個光 |
| `problem` | 真的看不清楚 | 橘紅底，給現場做得到的動作 |

`stylish` 用紫色而不是黃色，是刻意的——
它不是警告，是「系統懂你在什麼場合」。

只有 `problem` 才填 `issue`（too_dark / backlit / harsh …）。

### tip 會隨環境改變說法

**stylish 時教他怎麼用：**

```
🌃 藍紫霓虹・讓藍光從側面掃過商品邊緣
🕯️ 室內暖黃燈・暖黃燈很適合這道菜，靠近一點
🌇 黃昏逆光・轉到逆光側會有透光感
```

**problem 時給現場做得到的動作：**

```
用另一支手機的手電筒照一下
背光，主體太暗・從正面補光
```

提示詞裡明確禁止「請使用專業補光設備」這種話。

### 驗證層壓掉的自相矛盾

- 說 stylish 卻填了 issue 或要求補光 → 清掉
- 說 problem 卻沒說是什麼問題 → 降級成 stylish
- 舊格式相容：模型如果還回傳舊的 `verdict: "backlit"`，
  會自動轉成 `verdict: problem, issue: backlit`

### 除錯面板

```
環境 neon [stylish]
光線 來源:left 補:none 角度:keep
  建議 讓藍光從側面掃過商品邊緣
曝光 主體 0.18 / 背景 0.26 = 0.69 · 反差 0.290
  色調 冷(-0.42) 飽和 0.51 色相 225° 散布 0.34
```

---
## v0.23 · 2026-09-05 — 光線改成判斷「主體」而不是「場景」

### 包含檔案

```
server/models/schemas.py          (改：加入主體/背景欄位)
server/services/prompts.py        (改：LIGHT_SYSTEM 重寫)
web/js/vision/exposure.js         (改寫)
web/js/lib/api.js                 (改：影格裁成可見範圍)
web/js/lib/config.js              (改：版本 v0.23)
web/js/main.js                    (改：提供主體框)
web/js/planner/remotePlanner.js   (改：傳主體框、光線去重)
CHANGELOG.md
```

**後端有變動，要重啟 uvicorn。**

### 模型講的沒錯，但它在分析錯的東西

你的照片：左邊一盞極亮的舞台燈，你手上拿著識別證。

模型忠實地報告「光從左邊來、右邊暗、從右側補光」——
**它分析的是整個場景，不是你要拍的那張識別證。**

所以不管你怎麼補光，只要那盞燈還在畫面裡，結論就不會變。

而且它說「臉部太暗」。**你要拍的是識別證，不是臉。**

### 修法一：分開算主體與背景

`exposure.js` 現在會算：

| 欄位 | 意思 |
| --- | --- |
| `subject` | 目標框「內」的平均亮度 |
| `background` | 目標框「外」的平均亮度 |
| `subject_ratio` | 主體 / 背景 |

**`subject_ratio` 是判斷背光的客觀指標。**
背光的定義本來就是「主體比背景暗很多」：

```
< 0.55   主體明顯比背景暗 → backlit
0.55~1.6 正常
> 1.6    主體比背景亮很多，注意死白
```

送給模型的訊息會把這三個數字用粗體標出來，
並且直接寫上結論提示，最後補一句
「請以主體的三個數字為主，左右上下只是輔助」。

左右上下的數字仍然會送，但加註「背景有強光時會失真」。

### 修法二：提示詞改成判斷主體

`LIGHT_SYSTEM` 開頭就是：

> **你判斷的是「使用者要拍的那個東西」的光線，不是整個場景。**
> 畫面裡有強光源本身不是問題。只有當它讓要拍的東西變暗或反光時才是問題。
> **不要評論人臉、人物或背景陳設的光線。**

另外要求建議必須是**現場做得到的動作**：

```
好：「背對那盞燈，讓光打在商品正面」
好：「用手機手電筒從左邊照一下」
壞：「請使用專業補光設備」
```

畫面裡根本沒有要拍的東西時，回 ok 並留空 advice，不要硬給建議。

### 修法三：VLM 看到的畫面要和你看到的一樣

這是我剛發現的問題。

影片用 `object-fit: cover` 顯示，兩側或上下會被裁掉。
但 `grabFrame` 一直送**完整影格**給 VLM。

**你的情況：960x1080 的影片放進手機直式畫面，
有 37% 的區域是你看不到、但 VLM 一直在分析的。**

現在 `grabFrame` 和 `measure` 都只取可見範圍。
裁切比例已驗證與顯示區域完全一致。

### 順手修的

光線結論沒變時不再印 console，只有 verdict、source 或
fill_from 有變化才印。你剛剛那八行一模一樣的訊息就不會再出現。

### 這次之後該看到什麼

console 開頭：

```
[SnapFit] v0.23
```

除錯面板的曝光那行會變成：

```
曝光 主體 0.19 / 背景 0.41 = 0.46 左亮 過曝 2%
```

**主體那個數字才是重點。** 如果你把商品移進框裡、
數字上升到 0.4 以上，光線建議就應該跟著改變。

---
## v0.22 · 2026-09-05 — 修掉快取造成的靜默失效

### 包含檔案

```
server/main.py                    (改：靜態檔案不快取)
web/js/lib/config.js              (改：加版本戳記)
web/js/main.js                    (改：印出版本戳記)
web/js/planner/remotePlanner.js   (改：設定值保底)
CHANGELOG.md
```

**後端有變動，要重啟 uvicorn。**
**這一版之後就不必再按 Ctrl + Shift + R 了。**

### 光線為什麼一次都沒跑

看 server log 的檔案清單：

```
GET /js/main.js                   304
GET /js/planner/remotePlanner.js  304
GET /js/lib/api.js                304
...
```

**`/js/lib/config.js` 完全沒有出現。** 其他幾個檔案也是。

沒有出現代表瀏覽器**連問都沒問就直接用了硬碟快取**的舊版本。

而 `LIGHT_INTERVAL_MS` 是 v0.20 才加進 `config.js` 的，
舊版沒有這個值：

```js
this.lastLightSent = performance.now() - undefined + 1200;  // → NaN
now - NaN > undefined                                       // → false，永遠不成立
```

**光線路徑一次都沒被排到，而且完全不會報錯。**
這就是為什麼 server log 從頭到尾只有 `/api/plan`。

### 為什麼會被硬快取

FastAPI 的 `StaticFiles` 只送 `ETag` 與 `Last-Modified`，
**不送 `Cache-Control`**。

瀏覽器遇到沒有 `Cache-Control` 的回應時會套用「啟發式快取」：
自己決定一段時間內不重新驗證，連 304 都不問。

**這個問題已經咬了三次：**

| 版本 | 症狀 | 實際原因 |
| --- | --- | --- |
| v0.14 | 改了 CSS 但畫布還是爆掉 | 瀏覽器用舊 `app.css` |
| v0.21 | 光線分析「不見了」 | 瀏覽器用舊 `config.js` |

第二次特別陰險，因為它不報錯，只是靜靜地不執行。

### 修法一：根本上不快取

`server/main.py` 加了一個 `NoCacheStatic`：

```
Cache-Control: no-store, must-revalidate
Pragma: no-cache
Expires: 0
```

**之後每次重整一定拿到最新的檔案**，不需要記得按
`Ctrl + Shift + R`。開發階段這比快取效益重要得多。

（要上線的話再把它改回一般的 `StaticFiles`。）

### 修法二：設定值保底

就算之後又發生類似情況，也不能靜靜地變成 NaN：

```js
function cfg(key, fallback) {
  const v = CONFIG[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
```

三個節奏都改用它取值。缺值時退回內建預設，路徑照樣會跑。

### 修法三：版本戳記

`config.js` 加了 `BUILD: "v0.22"`。開啟時 console 會印：

```
[SnapFit] v0.22
[planner] 節奏 plan 700ms · light 6000ms · custom 冷卻 15000ms
```

**如果印出的版本不是最新的，就知道是快取問題。**
除錯面板第一行也會顯示建置版本。

第二行印出的是**實際生效的節奏**，
不是設定檔裡寫的值——如果保底機制被觸發，這裡會看得出來。

### 這次之後該看到什麼

重啟 uvicorn、重整頁面，console 應該出現：

```
[SnapFit] v0.22
[planner] 節奏 plan 700ms · light 6000ms · custom 冷卻 15000ms
相機解析度 960x1080
[light] ok 來源:left 補光:none
```

server log 應該開始出現 `/api/light`，大約每 6 秒一次。

---
## v0.21 · 2026-09-05 — 光線分析一直顯示

### 包含檔案

```
web/js/main.js                    (改)
web/js/planner/remotePlanner.js   (改)
web/css/app.css                   (改)
CHANGELOG.md
```

前端變動，**uvicorn 不用重啟**。CSS 改了，請 `Ctrl + Shift + R`。

### 不用把提示詞改回去

**光線的提示詞其實比原本更詳細。**

原本它擠在一個大提示詞裡，只有幾行；
現在 `LIGHT_SYSTEM` 有完整的判斷準則
（每個 verdict 該看什麼數字、方向怎麼從陰影推、
好與壞的建議範例）。改回去只會讓延遲問題回來。

問題出在兩個地方，都是我的：

### 問題一：光線正常時我把整條提示藏起來了

```js
if (!l || l.verdict === "ok") {
  el.light.classList.add("hidden");   // ← 這裡
}
```

你的房間光線大概沒問題，所以它一直是隱藏的。
**看起來像功能不見了，其實是它判斷「沒事」。**

現在改成三種狀態都顯示：

| 狀態 | 顏色 | 內容 |
| --- | --- | --- |
| 尚未取得 | 灰 | 「分析光線中…」 |
| 良好 | 灰 | 「光從左邊來」——方向是有用的資訊，不是警告 |
| 提醒（光太平、光太硬） | 黃 | 建議或成因 |
| 需要處理（太暗、過曝、背光） | 橘紅 | 具體動作 |

顯示範例：

```
[灰]   光從左邊來
[灰]   光線良好・改成斜 45 度
[黃]   光太平，沒有立體感・改成斜 45 度
[橘紅] 背光，主體太暗・從正面補光
[橘紅] 往窗邊移三步
```

### 問題二：第一次要等 6 秒

`lastLightSent` 初始值是 0，要 `performance.now() > 6000`
才會第一次觸發。你可能在那之前就覺得沒反應了。

改成初始化時就設成「差 1.2 秒就到期」，
**開啟後約 1.2 秒就會跑第一次光線分析**，之後才回到 6 秒節奏。

### 順手修的排程漏洞

`_runLight()` 和 `_runCustom()` 在抓不到影格時會提早 return，
**但沒有更新時間戳**。這代表下一輪還是輪到它，
主路徑就永遠排不上了。

現在早退也會更新時間戳。

### 新增 console 記錄

每次光線分析回來都會印一行：

```
[light] backlit 來源:back 補光:front 從正面補光
```

這樣不用開除錯面板也能確認它有在跑。

除錯面板也多了一行 `建議 ...` 顯示原始的 advice。

---
## v0.20 · 2026-09-05 — 三條路徑分開排程

### 包含檔案

```
server/models/schemas.py          (改：加入 LightRequest / CustomRequest)
server/routers/plan.py            (改寫：拆成三個端點)
server/services/prompts.py        (改寫：拆成三個提示詞)
server/services/validate.py       (改：validate_light 獨立)
server/services/chain.py          (改：支援逐次逾時)
web/js/main.js                    (改：三個 handler)
web/js/lib/api.js                 (改：加入 requestLight / requestCustom)
web/js/lib/config.js              (改：三種節奏)
web/js/planner/remotePlanner.js   (改寫：三路徑排程器)
scripts/scaffold.py               (改：.env 逾時 6000)
CHANGELOG.md
```

**後端有變動要重啟 uvicorn。**

### 先做這件事：改 .env

```
VLM_TIMEOUT_MS=6000
```

**你的日誌顯示還是 2.5 秒。** v0.15 就請你改了，看來沒改到。

而且注意這個模式：

```
12:03:05 逾時（>2.5s）
12:03:08 成功        ← 只差 3 秒
```

**很多「逾時」其實是回應正要到，被我們自己砍掉了。**

### 日誌分析：沒有併發問題

請求的間隔是 3 到 4 秒，客戶端 port 從頭到尾都是 `65405`。
**每次只有一個 `/api/plan` 在飛**，`inFlight` 閘門有在工作。

所以平行拆成兩組 client **不會變快**，
只會讓同一個過載的端點負擔加倍。

真正的原因是模型本身變慢了：
早上 `bench_vlm.py` 中位數 306ms，現在成功的請求要 2 到 4 秒。
這是國網的負載，不是我們的請求模式。

### 但拆開是對的，理由不同

**輸出的 token 數直接決定延遲**，而原本一次要它吐太多：

版型判斷 + 版型 id + 微調參數 + 動態版型座標 + 物品配置
+ 移除清單 + 光線五個欄位 + 構圖建議，`max_tokens=700`。

**所以要拆，但是按「變化速度」拆，不是按平行度拆。**

| 端點 | 內容 | 節奏 | max_tokens |
| --- | --- | --- | --- |
| `/api/plan` | 版型判斷 + 物品配置 + 移除 | 700ms（且畫面有變化） | 250 |
| `/api/light` | 光線分析 | 6 秒 | 160 |
| `/api/custom` | 動態版型生成 | 只在需要時，冷卻 15 秒 | 420 |

**光線根本不需要每次都算。** 房間的光幾秒內不會變，
但物品位置會。原本綁在一起是純浪費。

**動態版型的座標很吃 token**，但一百次裡可能只用到一次。
放在主路徑裡，等於每次都為了一個很少發生的情況付費。

### 三條路徑互相禮讓，不平行

排程器刻意只讓一條路徑在飛。同時打同一個端點會讓兩邊都變慢。

優先序：`custom` > `light` > `plan`。
前兩者比較少發生，讓它們先過，免得永遠排不到。

### 提示詞縮減

| | 字元數 |
| --- | --- |
| 舊版單一提示詞 | 約 2400 |
| 新版 PLAN | 729 |
| 新版 LIGHT | 686 |
| 新版 CUSTOM | 536 |

**主路徑的提示詞少了七成。**

### 動態版型的冷卻時間

生成一次很貴，而且生完之後應該讓使用者有時間照著擺。
每隔幾秒就換一個新版型的話，使用者根本來不及反應。

所以加了 15 秒冷卻。不管成功與否都會清掉 `needsCustom`，
避免一直卡在重試。

### 除錯面板

呼叫統計拆成三條：

```
呼叫 plan 12 · light 3 · custom 0 · 略過 41
```

**light 的數字應該遠小於 plan**，custom 大多是 0。
如果 custom 一直在跳，代表模型太常判定內建版型不合用，
那要回頭調 PLAN_SYSTEM 裡「優先選 good 或 adjust」那句話的力道。

---
## v0.19 · 2026-09-05 — 多情境 + 光線分析 + 鏡頭切換 + 動態版型

### 包含檔案

```
server/models/schemas.py              (改寫)
server/services/prompts.py            (改寫)
server/services/validate.py           (改寫)
server/routers/plan.py                (改寫)
web/index.html                        (改)
web/css/app.css                       (改)
web/js/main.js                        (改寫)
web/js/intents.js                     (新)
web/js/vision/exposure.js             (新)
web/js/camera/devices.js              (新)
web/js/camera/camera.js               (改：支援指定鏡頭)
web/js/layouts/adjust.js              (新)
web/js/layouts/index.js               (改)
web/js/layouts/definitions/overhead.js (新)
web/js/layouts/definitions/angle45.js  (新)
web/js/guidance/phrases.js            (改寫)
web/js/ui/pickers.js                  (新)
web/js/ui/layoutBadge.js              (改)
web/js/lib/api.js                     (改)
web/js/planner/remotePlanner.js       (改)
CHANGELOG.md
```

**後端有變動，要重啟 uvicorn。**
前端請用 `Ctrl + Shift + R` 強制重整。

---

### 我要更正自己一件事

昨天我說「VLM 判斷不了光影」，那是誤導。

我測的是一個 `light: ok/too_dark/backlit` 的列舉欄位，
那是在問**絕對曝光值**——模型沒有參照基準，當然答不準。

但你要的是「光從哪來、該從哪補、該從哪拍」，
那是**方向性與空間推理**，正是 VLM 的強項。
我測錯了東西，然後用錯誤的結論去否定需求。

**現在的做法是兩邊各做自己擅長的事：**

```
本機算客觀曝光數字 → 連同影像送給 VLM → VLM 給方向性建議
```

`vision/exposure.js` 用 64x64 取樣算出：
整體平均亮度、過曝與死黑的像素比例、左右上下中央各區的亮度。

這些數字連同影像一起送出，VLM 拿它們當基準，回傳：

| 欄位 | 內容 |
| --- | --- |
| `verdict` | ok / too_dark / too_bright / backlit / harsh / flat |
| `source` | 光從哪來：left / right / top / front / back / mixed |
| `fill_from` | 該從哪補光：left / right / front / top / none |
| `shoot_from` | 建議角度：overhead / high_45 / eye_level / low / keep |
| `advice` | 一句 25 字內的具體動作 |

畫面上光線建議**獨立一條黃色提示**，
不和構圖提示混在一起，否則會互相蓋掉。

---

### 多情境

不再只服務二手賣家。點左上角的標籤切換：

| 情境 | 適用版型 |
| --- | --- |
| 🍜 美食 | 俯拍、斜 45 度、單品主體、細節特寫、平拍排列 |
| 📦 二手商品 | 單品主體、主角加配件、平拍排列、細節特寫 |
| ✨ 商品情境 | 主角加配件、單品主體、平拍排列、斜 45 度 |

每個情境有各自的**提示詞補充**（後端 `INTENT_GUIDE`）。
以美食為例，會告訴模型：
側光或斜逆光最好看、正面直打光會讓食物扁平、
俯拍適合平面擺盤、斜 45 度適合有高度的。

**新增兩個食物版型：**

- **俯拍**：主餐略偏中心，兩個配位在對角形成斜線動線
- **斜 45 度**：主體放得比俯拍低，上方留白，前後層次明顯

**新增情境的步驟：**
1. `web/js/intents.js` 加一筆
2. `server/services/prompts.py` 的 `INTENT_GUIDE` 加說明
3. 需要新版型就在 `definitions/` 加，並列進 `layouts`

---

### 動態版型

VLM 每次都會先判斷**目前的版型合不合用**（`fit`）：

| fit | 意思 | 動作 |
| --- | --- | --- |
| `good` | 合用 | 不動 |
| `adjust` | 大方向對，要微調 | 套用參數 |
| `custom` | 都不合用 | 生成新版型 |

**`adjust` 是受約束的參數，不是自由座標：**

```json
{"mirror": true, "scale": 1.15, "shift_x": -0.04, "shift_y": 0.02}
```

範圍夾死：`scale` 0.85~1.20、`shift` ±0.08。
套用後所有框會被推回安全區 `y ∈ [0.12, 0.76]`，
**優先平移而不是裁切**，這樣框不會變形。

已測試：六個版型 × 極端參數組合，全部守得住安全區。

**`custom` 的防呆（後端 `validate_custom`）：**

- 超界的框夾進安全區
- 太小（<2% 面積）或太大（>72%）的框丟掉
- 兩框重疊超過 55% 就丟掉後者
- 沒有主角就把面積最大的升格
- 有多個主角就只留面積最大的
- 位置上限 5 個
- **修不動才退回 `good`**，不是整份丟掉

---

### 一個順手修掉的缺陷

動態版型被拒絕、而模型又沒給有效的內建版型 id 時，
原本整份回應會被丟掉——**連光線建議也一起沒了**。

光線建議跟版型無關，不該被連坐。

現在把前端目前的版型傳給後端當退路，
版型判斷失敗時沿用現有版型，光線與物品配置保住。

---

### 鏡頭切換

左上角第二個標籤，只有兩顆以上鏡頭時才顯示。

`camera/devices.js` 會列出所有相機，並把冗長的裝置名稱
（`camera2 0, facing back (0a1b2c3d)`）翻成「後廣角」這種短標籤。

**兩個一定會踩到的限制，程式已經處理：**

1. 沒有相機權限之前，`enumerateDevices()` 的 label 全是空字串。
   所以列舉一定要在成功 `getUserMedia` 之後。
2. 切換一定要先關舊串流。很多手機同時只能開一顆鏡頭，
   不先關會拿到 `NotReadableError`。

切換失敗會自動退回原本能用的鏡頭。

---

### 按鍵

| 鍵 | 作用 |
| --- | --- |
| `I` | 切換情境 |
| `C` | 切換鏡頭 |
| `1`~`6` | 直接選版型（同時鎖定） |
| `U` | 解除鎖定，交還給 VLM |
| `M` | 切換暗化遮罩 |
| `D` | 除錯面板 |

除錯面板新增：情境、fit 狀態、曝光摘要、光線分析結果、鏡頭數量。

---

### 還沒做的

依 `07-TODAY.md` 的排程，剩下：

- 音訊回應（`phrases.js` 的文案已經備好）
- 變焦與對焦
- 前後對比、商品文案（你決定往後排）

---
## v0.18 · 2026-09-05 — 開發日計畫

### 包含檔案

```
docs/07-TODAY.md    (新：當日排程與各功能評估)
docs/03-TODO.md     (改：加入今日項目)
README.md           (改：文件導覽補上 06、07)
CHANGELOG.md
```

只有文件。

### 你提的六項，三項要調整

**「LLM 判斷光影」和實測結果衝突。**

9/4 的 `check_stability.py`：純白圖（完全過曝）
**8/8 判定為 `light: ok`**。模型對絕對亮度沒有可靠判斷力，
因為它沒有曝光的參照基準。調提示詞也不會準。

改成在 `quality.js` 本機算平均亮度與過曝比例。
純數學，又快又準又能離線。

留給 LLM 的是**語意判斷**：背光、陰影蓋住商品、
反光讓字看不清楚——這些需要理解畫面內容，本機算不出來。

**「LLM 選擇邊框」v0.9 就做完了。**

所以你真正想要的是第三項，兩項合併處理。

**「LLM 產生動態邊框」要用受約束的版本。**

D1 已經說明過自由生成座標的問題：框會亂跳、
沒有構圖先驗、AI 失效時無處可退。

改成 LLM 輸出**參數**而非座標：

```json
"adjust": {"mirror": true, "scale": 1.15, "shift_x": -0.04}
```

前端套用在既有版型上並夾在安全範圍內。
保有構圖正確性，又能適應實際場景。

### 排序的關鍵：Demo 還沒有高潮

三分鐘腳本裡最有說服力的是**前後對比**——
評審隨手拍的醜照片和引導後的照片並排。

**這個還沒做。** 沒有它，Demo 到最後只是「框會跟著變」，
評審不會有「喔」的那一聲。

所以它排在今天所有新功能之前。

### 今日排程

| 區段 | 項目 | 時數 |
| --- | --- | --- |
| P0 | 前後對比 + 商品文案 | 3.5h |
| P1 | 音訊 + 鏡頭切換 + 本機光影 | 4.0h |
| P2 | 版型參數化 + 變焦對焦 | 4.0h |
| 收尾 | 測試 + 錄備援影片 | 1.5h |

累計 13 小時，留 1 小時緩衝。

**停損：任何一項超時 50% 立刻停手。P2 可以整包砍掉。**
**22:00 前一定要錄好備援影片，之後才繼續做功能。**

### 變焦的相容性提醒

`applyConstraints({ zoom })` 在 iOS Safari **完全不支援**，
桌機幾乎都不支援，Android 多數可以。

**一定要先做能力偵測，不支援就降級成畫面裁切的數位變焦。**
Demo 當天不知道評審拿什麼手機，降級路徑不能省。

---
## v0.17 · 2026-09-04 — 記錄區域網路直連的實測結論

### 包含檔案

```
docs/05-DECISIONS.md    (加入 D13)
docs/06-RUNBOOK.md      (加入實測結論)
CHANGELOG.md
```

只有文件，程式沒動。

### 實測結論：區域網路直連在這個環境行不通

依序排除了：

| 已排除 | 方法 |
| --- | --- |
| 服務沒綁對介面 | `--host 0.0.0.0` 有加 |
| Windows 防火牆 | 已建立輸入允許規則，Profile = Any |
| Cloudflare WARP 干擾 | 已中斷 |

**結果：手機「回應時間過長」，uvicorn 完全沒有任何 log。**

沒有 log 代表封包根本沒到達電腦。在防火牆已放行、
VPN 已關閉的前提下，剩下的唯一解釋是
**手機熱點的用戶端隔離**——熱點禁止連上來的裝置互相通訊。
這是手機端的行為，電腦怎麼改都沒用。

**下次遇到「回應時間過長 + 完全沒有 log」，直接跳過不要查。**

### 為什麼 Tunnel 本來就是唯一的路

| | 區域網路直連 | Cloudflare Tunnel |
| --- | --- | --- |
| 需要手機連得到電腦 | 是 | 否（電腦主動對外） |
| 受防火牆影響 | 是 | 否 |
| 受熱點隔離影響 | 是 | 否 |
| 是不是安全來源 | 否（HTTP） | **是（HTTPS）** |
| 相機能不能用 | **不能** | 能 |

最後一列才是關鍵。**就算連線問題全部修好，
`http://192.168.x.x:8000` 一樣開不了相機**，
因為瀏覽器規定相機只能在安全來源下使用。

所以區域網路直連從一開始就不是可行路線，
它最多只能檢查版面。

### 對樹莓派部署的影響：沒有

搬到 Pi 之後做法完全相同，Tunnel 從 Pi 上開就好。
不需要改架構，也不會有額外的坑。

`scripts/tunnel.py` 在 Pi 上一樣能跑
（把指令裡的反斜線換成正斜線即可）。

---
## v0.16 · 2026-09-04 — 徹底修掉畫布迴圈 + HTTPS 一鍵開啟

### 包含檔案

```
web/js/ui/overlayCanvas.js    (改：量父容器而不是畫布自己)
scripts/tunnel.py             (新：起 tunnel 並印出 QR code)
scripts/scaffold.py           (改：requirements 加入 qrcode)
docs/06-RUNBOOK.md            (改：手機測試改用 tunnel.py)
requirements.txt              (改：加入 qrcode)
CHANGELOG.md
```

解壓後跑一次 `pip install -r requirements.txt`（多了 qrcode）。
前端變動重整即可。

### 保險絲的訊息證實了診斷

```
畫布尺寸異常 4800x2400，已停止調整。
```

從畫布預設的 `300x150` 開始，dpr=2 連乘四次正好是
`4800x2400`，長寬比一模一樣。**完全吻合。**

但這也代表 v0.14 那兩行 CSS 沒生效，多半是瀏覽器
快取住舊的 `app.css`。現在能用是保險絲擋住了，不是修好了。

### 這次改成根本不依賴 CSS

**量「父容器」的尺寸，不量畫布自己。**

`<canvas>` 是替換元素，改變它的點陣尺寸會連帶改變它的版面尺寸。
拿畫布自己的 `getBoundingClientRect()` 當依據就會變成：

```
量到 300x150 → 設點陣 600x300 → 版面變 600x300
→ ResizeObserver 觸發 → 量到 600x300 → 設 1200x600 → ...
```

**父容器的尺寸不會被畫布影響**，所以迴圈從源頭就不存在。

另外三道保險：

- `ResizeObserver` 改成觀察父容器，不觀察畫布
- 每次調整時明確寫死 `canvas.style.width/height`，
  就算 CSS 漏了也會補上
- 原本的 4096px 上限與 40 次上限保留

現在就算把 `app.css` 整個刪掉，也不會再出現這個問題。

### scripts/tunnel.py

```powershell
python scripts\tunnel.py
```

它會：

1. 檢查 `cloudflared` 有沒有安裝，沒有的話告訴你怎麼裝
2. 起 tunnel，從輸出裡抓出 `https://xxx.trycloudflare.com`
3. **直接在終端機印出 QR code**，拿手機掃就能開
4. 同時存一份 `assets/tunnel-qr.png`
5. 之後只印錯誤訊息，不洗版

**為什麼一定要 HTTPS：**
瀏覽器規定相機只能在「安全來源」下使用。
安全來源是 HTTPS 或 `localhost`，
`http://192.168.x.x:8000` 這種純 IP 的 HTTP 一律不行。

**Demo 當天記得：**
每次重啟 tunnel 網址都會變。要提早開好、把
`assets/tunnel-qr.png` 印出來貼在攤位上，不要臨場產生。

**如果電腦上有 Cloudflare WARP 在跑，先中斷它**，
兩者會打架。你的 ipconfig 顯示它是開著的。

### 手機測試的順序

```powershell
# 視窗 1
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000

# 視窗 2
python scripts\tunnel.py
```

掃 QR，按「開始拍攝」，允許相機權限。

手機上按不了鍵盤快捷鍵，所以除錯面板看不到。
要看的話用 Chrome 的 `chrome://inspect` 遠端偵錯，
或先在電腦上確認一切正常再拿去手機。

---
## v0.15 · 2026-09-04 — 疊層改成真正的透明層 + 請求不再堆積

### 包含檔案

```
web/js/ui/overlayCanvas.js    (改：遮罩改用 even-odd 單次填充)
web/js/planner/remotePlanner.js (改：計時基準改為收到回應後)
web/js/lib/config.js          (改：遮罩與間隔設定集中)
web/js/main.js                (改：M 鍵切換遮罩)
scripts/scaffold.py           (改：.env 範本逾時 2.5s → 4s)
CHANGELOG.md
```

前端變動，**uvicorn 不用重啟**。
但建議手動把 `.env` 的 `VLM_TIMEOUT_MS` 改成 `4000`
（見下方說明），改完才需要重啟。

### 你的兩個判斷，一個對一個要修正

**「底層不要動」——方向對，但這次的 bug 不是這樣造成的。**

影片和疊層本來就是獨立元素，程式從頭到尾沒碰過影片。
v0.14 的白畫面是畫布把整個合成器搞垮了，影片是被連累的。
分層再乾淨也擋不住。

**但你指出了一個真的問題。**

原本的暗化遮罩是：先把整張畫布填滿半透明黑，
再用 `globalCompositeOperation = "destination-out"` 把框挖掉。

也就是說疊層根本不是「其他都透明」，
而是**一整張蓋在影片上的黑布**，而且每次重畫都要切換合成模式。

**改成單一路徑 + even-odd 填充規則。**

原理：外框走一圈、每個洞各走一圈，
被奇數個路徑包住的區域才填色。
洞在外框裡面（被 2 個路徑包住，偶數），所以不填，
自然透出底下的相機畫面。

**一次 `fill()`，完全不切換合成模式。**
程式裡已經沒有任何 `globalCompositeOperation`。

**「每秒發給 VLM」——頻率沒問題，但計時基準錯了。**

原本從「送出」開始算 800ms。後端變慢時（你的日誌已經
出現 2.5 秒逾時），間隔早就過完了，回應一回來馬上又送下一個，
請求擠在一起，後端更慢，惡性循環。

**改成從「收到回應之後」才開始計時。**

節奏自動變成「延遲 + 間隔」：
後端 300ms 時大約每秒一次，後端變慢時自動放慢，
**請求永遠不會堆積**。

### 建議手動改 .env

你的日誌開始出現 `nchc 逾時（>2.5s）`。
早上實測中位數是 306ms，晚上變慢應該是尖峰時段。

打開 `.env`，把這一行改成：

```
VLM_TIMEOUT_MS=4000
```

改完重啟 uvicorn。逾時本來就會自動降級（維持現有版型），
不會壞事，但放寬一點可以多接住一些慢回應。

如果還是常逾時，改用小模型：

```
NCHC_MODEL=Microsoft-Phi-4-multimodal-instruct
```

這個任務很簡單（看圖挑選項），不一定需要 26B。

### 新按鍵：M

切換暗化遮罩。關掉之後疊層只剩框線，**完全透明**，
對底下影片圖層的干擾最小。

可以自己比較兩種的視覺效果。如果覺得沒有遮罩比較好，
把 `web/js/lib/config.js` 的 `MASK_ALPHA` 改成 `0` 就是預設關閉。

除錯面板會顯示目前的遮罩狀態。

---
## v0.14 · 2026-09-04 — 找到白畫面的真正原因：畫布尺寸失控成長

### 包含檔案

```
web/css/app.css               (改：#overlay 加上 width/height)
web/js/ui/overlayCanvas.js    (改：加上失控成長的保險絲)
web/js/main.js                (改：除錯面板顯示尺寸調整次數)
CHANGELOG.md
```

前端變動，**uvicorn 不用重啟**。
重整請用 `Ctrl + Shift + R`，CSS 改了。

### 真正的原因（v0.13 的判斷是錯的）

**`<canvas>` 是「替換元素」（replaced element）。**

對於絕對定位的替換元素，如果 CSS 沒有明確給 `width` 和 `height`，
它會使用**自己的內在尺寸**（也就是點陣的寬高），
**不會被 `inset: 0` 撐開。**

原本的 CSS：

```css
#overlay { position: absolute; inset: 0; }   /* 少了 width/height */
```

於是形成一個正回饋迴圈：

```
畫布預設 300x150
  → getBoundingClientRect() 讀到 300x150
  → 程式把點陣設成 300 x dpr
  → 點陣變了，內在尺寸跟著變，CSS 尺寸也變
  → ResizeObserver 觸發，再量一次
  → 600 x dpr → 1200 x dpr → 2400 x dpr → ...
```

dpr = 2 時的實際成長：

| 輪次 | 尺寸 |
| --- | --- |
| 1 | 600 |
| 2 | 1200 |
| 3 | 2400 |
| 4 | 4800 |
| 5 | 9600 |
| 8 | 76800（約需 22 GB 記憶體） |

瀏覽器在第四、五輪就撐不住，**合成器死掉，畫面全白**。

### 這解釋了每一個症狀

| 症狀 | 原因 |
| --- | --- |
| 一開始有畫面 | 畫布還小 |
| 卡了一下 | 瘋狂配置越來越大的畫布 |
| 然後白掉 | 顯示卡記憶體耗盡，合成器死亡 |
| 沒有任何 JS 錯誤 | 這是合成層的問題，不是程式錯誤 |
| 看門狗說相機正常 | 串流確實沒事，壞的是顯示 |
| Chrome 和 Edge 都一樣 | 兩者共用同一套排版與合成引擎 |
| 裝置模擬下更嚴重 | 有效 dpr 更高，成長更快 |

**也解釋了最早那張截圖裡框的位置很奇怪。**
當時畫布只有 300x150 且貼在左上角，
所以用比例座標畫出來的框全擠在畫面上方。

`#camera` 是 `<video>`，同樣是替換元素，
但它有明確的 `width: 100%; height: 100%`，所以沒事。
就漏了畫布這一個。

### 關於 v0.13 的 backdrop-filter

那個判斷是錯的，`backdrop-filter` 不是主因。

不過移除它仍然是正確的——疊在影片上的 `backdrop-filter`
本來就會增加不必要的合成成本。v0.13 的其他改動
（影像看門狗、事件監聽）也都保留，它們幫忙排除了
「串流中斷」這個可能性，讓範圍縮小到顯示層。

### 加了保險絲

即使 CSS 之後又被誰改壞，程式也不會再把瀏覽器拖垮：

- 單邊超過 4096px 就停止調整並在 console 報錯
- 尺寸調整超過 40 次也停止
- 除錯面板會顯示「⚠ 尺寸失控」

### 怎麼確認修好了

按 `D` 看這一行：

```
重畫 6 次 · 尺寸調整 2 次
```

**「尺寸調整」應該是個位數**（開啟時一次、視窗變動時一次）。
如果它一直往上跳，代表迴圈還在，跟我說。

---
## v0.13 · 2026-09-04 — 找到白畫面的真凶：backdrop-filter

### 包含檔案

```
web/css/app.css               (改：移除 backdrop-filter)
web/js/camera/camera.js       (改：加入影像看門狗)
web/js/main.js                (改：除錯面板顯示相機健康資訊)
CHANGELOG.md
```

前端變動，**uvicorn 不用重啟**，重整瀏覽器即可。
重整記得用 `Ctrl + Shift + R` 強制清快取，CSS 改了。

### 真凶

`app.css` 裡的版型標籤和提示條都用了：

```css
backdrop-filter: blur(12px);
```

而這兩個元素就疊在 `<video>` 正上方。

`backdrop-filter` 會強迫瀏覽器把底下的內容重新合成一次。
**疊在影片上的 backdrop-filter 在 Chromium 系瀏覽器
（Chrome、Edge）是有名的合成器地雷**，
加上 DevTools 裝置模擬的額外縮放層，很容易把影片圖層弄壞。

症狀完全吻合你看到的：

- 影片變空白（顯示瀏覽器的破圖佔位符）
- 其他 DOM 元素照常顯示（標籤、提示條都在）
- **沒有任何 JavaScript 錯誤**
- VLM 也正常運作

改成不透明度高一點的純色背景，視覺上幾乎沒差。
另外給 `#camera` 加了 `transform: translateZ(0)`，
讓它成為獨立的合成圖層，減少與上層元素互相影響。

### 影像看門狗

不確定上面那個是唯一原因，所以加了監測，
下次再壞就有資料可查，而且它會先自己嘗試復原。

**每秒檢查一次**：video 有沒有尺寸、有沒有被暫停、
track 是不是還 live。

**連續 3 次異常才動作**，避免切分頁之類的短暫狀況誤判。

**先自己救**：重新接一次 `srcObject`、重新 `play()`。
最多試 2 次，救不回來才顯示錯誤畫面。

同時監聽 video 的 `error` / `emptied` / `stalled` /
`suspend` / `pause` / `waiting` / `ended` 事件並記錄。
影片變空白時通常不會有 JS 錯誤，只會靜靜地觸發這些事件，
不記下來完全無從查起。

被暫停時會自動再 `play()` 一次，那是最常見的假死。

### 除錯面板新增三行

按 `D`：

```
相機 正常
  video 960x1080 ready=4 播放中
  track live 異常 0/3 復原 0
  最近事件 -
```

**壞掉時這三行會直接告訴你原因：**

| 看到什麼 | 代表 |
| --- | --- |
| `video 0x0` | 影片元素沒有畫面 |
| `暫停` | 被瀏覽器暫停了 |
| `track ended` | 串流被關掉 |
| `track live (muted)` | 系統或其他程式搶走相機 |
| `最近事件 error@...` | 影片元素報錯，時間點會標出來 |

### 還是建議做的兩件事

**1. 關掉 DevTools 的裝置模擬。**
它會多一層縮放合成，是這類合成器問題的放大器。
先確認一般視窗下穩定，再開模擬器檢查版面。

**2. 用 Edge 以外的瀏覽器交叉測試。**
如果 Chrome 正常而 Edge 不正常，那就是瀏覽器層的問題，
不是你的程式。Demo 當天用正常的那個。

---
## v0.12 · 2026-09-04 — 手機連線診斷

### 包含檔案

```
scripts/net_check.py     (新)
docs/06-RUNBOOK.md       (改：手機測試章節重寫)
CHANGELOG.md
```

只是工具與文件，程式沒動。

### 最重要的一件事

**`http://10.21.134.45:8000` 就算連得上，相機也開不起來。**

瀏覽器規定 `getUserMedia` 只能在「安全來源」下使用。
安全來源是 HTTPS 或 `localhost`，
純 IP 的 HTTP 一律不行。

所以區域網路直連這條路，只能用來檢查版面，不能測相機。

### 三個測試方法

| 方法 | 能測相機 | 說明 |
| --- | --- | --- |
| Cloudflare Tunnel | ✓ | 最通用，Android/iPhone 都行 |
| USB + Chrome 連接埠轉送 | ✓ | Android 專用，最快，不依賴網路 |
| 同網段直連 | ✗ | 只能看版面 |

**USB 那個方法值得記起來。**手機看到的網址是 `localhost`，
屬於安全來源，相機可以用，而且完全不受網路環境影響。
會場 Wi-Fi 塞爆時這是最穩的開發方式。

### 從你的 ipconfig 看到的三個嫌疑犯

**1. Windows 防火牆（機率最高）**

手機熱點會被 Windows 判定成「公用網路」，
公用設定檔預設封鎖所有輸入連線。

用系統管理員身分開 PowerShell：

```powershell
New-NetFirewallRule -DisplayName "SnapFit 8000" -Direction Inbound `
  -Protocol TCP -LocalPort 8000 -Action Allow -Profile Any
```

`-Profile Any` 不能省。

**2. Cloudflare WARP（172.16.0.2）**

WARP 是全流量 VPN，會接管路由，
常見副作用就是區域網路互連被切斷。測試時先中斷它。

**3. 手機熱點的用戶端隔離**

很多熱點預設禁止連上來的裝置互相通訊。這個沒得改。

### net_check.py 會檢查什麼

```powershell
python scripts\net_check.py
```

- 服務有沒有在監聽，是不是綁在 `0.0.0.0`
- 列出所有本機 IPv4，並標註哪個是手機該用的
  （會認出 WARP 的 172.16.0.2 和 VirtualBox 的 192.168.56.1，
  提醒你不要用那些）
- Windows 防火牆有沒有放行規則，目前是不是公用網路
- 有沒有偵測到 WARP 在跑
- 最後印出該用哪個網址，以及三種測試方法的指令

netstat 不可用時會自動改用 socket 直連判斷。

---
## v0.11 · 2026-09-04 — 修渲染程序被拖垮（白畫面 + 哭臉）

### 包含檔案

```
web/js/main.js                (改寫：改成事件驅動)
web/js/ui/overlayCanvas.js    (改：尺寸變化時通知上層重畫)
web/js/lib/api.js             (改：拿掉多餘的 willReadFrequently)
web/js/camera/camera.js       (改：降低請求解析度)
CHANGELOG.md
```

前端變動，**uvicorn 不用重啟**，重整瀏覽器即可。

### 為什麼會白掉

「剛開始有畫面，卡了一下後就渲染失敗」——這個描述是關鍵。

**渲染迴圈在做白工。**

原本 `overlay.draw()` 每秒跑 10 次，每次都做
「整張畫布填滿 + 合成挖洞 + 畫四個框 + 畫標籤」。

但畫面上根本沒有東西在變。目前還沒有物件偵測，
版型只有在 VLM 回應時才會換，也就是**最多一秒一次**。
剩下 9 次全是浪費。

在 DevTools 裝置模擬下這個成本會被放大（模擬器要額外做縮放合成），
加上 1280x1080 的影像解碼，足以把渲染程序拖垮，
畫面就變成白底加哭臉。

### 修法：事件驅動

現在只有這三種情況會重畫：

1. VLM 回傳新的計畫
2. 使用者手動切換版型
3. 畫布尺寸改變（轉向、視窗調整）

移除了 10fps 的 `requestAnimationFrame` 迴圈。
`frameLoop.js` 留著沒刪，之後做物件偵測時會用上。

除錯面板現在會顯示「重畫 N 次（事件驅動）」，
那個數字應該**遠小於**經過的秒數乘以 10。

### 順手修的兩個

**`willReadFrequently` 用錯地方。**
`frameCanvas` 只做 `drawImage` 與 `toDataURL`，
不做 `getImageData`，加了這個參數反而會強制走 CPU 後端，變慢。
只有做畫面變化偵測的 32x32 小畫布才需要。

**相機解析度降到 960x1280。**
送給 VLM 的只有 512px，拍照存檔 960 也足夠，
而解析度越高影像解碼越吃資源。

### 除錯面板現在長這樣

按 `D`：

```
畫布 375x667 @2x
重畫 8 次（事件驅動）
版型 hero_props
場景 桌上有耳機
指派 {"main":"白色耳機"}
移除 —
VLM 412ms · 1.3s 前 · 失敗 0
送出 6 · 略過 23（畫面沒變）
相機 正常
```

**兩個要看的數字：**
- 「重畫」應該是個位數到幾十，不是幾百
- 「略過」應該明顯大於「送出」

### 關於那兩個 404

`js/vendor/tf.min.js` 和 `coco-ssd.min.js` 目前**用不到**，
因為這一版是讓 VLM 直接看圖，沒有跑本機物件偵測。

`index.html` 的 `onerror` 會退回 CDN，CDN 也載不到就算了，
不影響功能。之後做對齊判斷時才需要跑 `fetch_vendor.py`。

---
## v0.10 · 2026-09-04 — 修相機中斷 + 大幅減少 VLM 呼叫

### 包含檔案

```
web/js/camera/camera.js           (改寫)
web/js/lib/api.js                 (改寫)
web/js/planner/remotePlanner.js   (改寫)
web/js/main.js                    (改)
scripts/fetch_vendor.py           (新，補齊 404)
CHANGELOG.md
```

前端變動為主，**uvicorn 不用重啟**，重整瀏覽器即可。

### 那個哭臉是什麼

Chrome 的**媒體元素壞掉佔位圖**。代表 `<video>` 的串流沒了。

後端日誌完全正常（VLM 一直在回應、提示文字也在更新），
所以壞掉的只有相機那一路。

**最可能的原因：在相機還開著的時候重整頁面。**
日誌 16:41:50 有一次 `GET /` 304，就是那次重整。
舊頁面沒有釋放相機硬體就被砍掉，新頁面拿到的串流馬上結束。

**修法：**
- `pagehide` / `beforeunload` 時主動釋放相機
- `start()` 一開始先把可能還握著的舊串流放掉
- 監聽 track 的 `ended` 事件，中斷時顯示明確的錯誤與重試按鈕，
  而不是讓使用者看到一個哭臉

### 日誌暴露的更大問題：VLM 被無止境呼叫

從 16:41:53 到 16:42:40，**將近五十次請求**，
而且畫面根本沒在動。

三分鐘的 Demo 就是兩百多次呼叫。吃額度、燒電力，
而且畫面沒變的話結果也不會變。

**修法：畫面沒變就不送。**

把畫面縮成 32x32 灰階指紋，和上一次比較平均差異。
這是很便宜的計算（1024 個像素），但足以判斷使用者是不是在搬東西。

| 機制 | 說明 |
| --- | --- |
| 畫面變化偵測 | 沒變就跳過，這個省最多 |
| 分頁背景暫停 | 切走就不分析 |
| 同時只飛一個請求 | 前一個沒回來不送下一個 |
| 失敗指數退讓 | 800ms → 最多 8 秒 |
| 12 秒保險刷新 | 太久沒送還是補一次，避免變化太小沒被抓到 |

除錯面板（按 `D`）現在會顯示「送出 N 次 · 略過 M 次」，
可以直接看到省了多少。

### 順手修的記憶體問題

`grabFrame` 原本每次呼叫都 `document.createElement("canvas")`，
每秒一次累積下來會造成記憶體壓力，手機上可能讓分頁被系統回收。

改成重複使用同一個 canvas。畫面變化偵測用另一個 32x32 的小畫布。

### 補上 fetch_vendor.py

日誌裡的 `GET /js/vendor/tf.min.js 404` 是因為那支腳本
還是 scaffold 留下的佔位檔。現在寫好了。

**不過目前這一版沒有用到 TF.js**（改由 VLM 直接看圖），
所以那兩個 404 不影響功能，之後做對齊判斷時才會用上。

### 除錯面板新增

按 `D` 現在會多顯示：

```
送出 12 次 · 略過 47 次（畫面沒變）
相機 正常
```

框的位置如果還是怪，看第一行的畫布尺寸對不對。

---
## v0.9 · 2026-09-04 — LLM 持續自動判斷版型 + 視覺強化

### 包含檔案

```
server/config.py                      (新)
server/main.py                        (改：接上 router、真實 warmup)
server/models/schemas.py              (新)
server/routers/plan.py                (新)
server/services/chain.py              (新)
server/services/prompts.py            (改寫)
server/services/validate.py           (改寫)
server/services/vlm/base.py           (新)
server/services/vlm/nchc.py           (新)
server/services/vlm/gmi.py            (新)
server/services/vlm/openai_provider.py (新)
web/index.html                        (改：加除錯面板)
web/css/app.css                       (改：加除錯面板樣式)
web/js/main.js                        (改寫)
web/js/lib/api.js                     (新)
web/js/planner/remotePlanner.js       (新)
web/js/ui/overlayCanvas.js            (改寫)
web/js/layouts/definitions/*.js       (改：座標收進安全區)
CHANGELOG.md
```

**解壓後要重啟 uvicorn**（後端有變動）。

### 解決了你回報的三個問題

**1. 框的位置跑掉**

原本只在建構 OverlayCanvas 時量一次 `getBoundingClientRect`。
如果當下版面還沒穩定（字體載入中、網址列收合、startScreen
的淡出動畫還在跑），量到的尺寸就是錯的，框的位置會整個偏掉。

改用 `ResizeObserver` 持續校正，另外在 300ms 後再量一次保險。

同時把四個版型的座標收進安全區 `y ∈ [0.13, 0.75]`，
避開上方的版型標籤和下方的提示條與快門。

**2. 框不夠明顯**

加了**暗化遮罩**：框以外的區域壓暗 50%，框內維持原樣。
這是取景器的標準做法，框會非常明顯，而且使用者的注意力
自然被導向該放東西的位置。

另外把線加粗、加陰影、四角加粗成取景框的樣子。

**3. LLM 自動判斷版型**

現在每 800ms 送一幀給 VLM，它會回傳：

```json
{
  "layout": "hero_props",
  "scene": "桌上有耳機和水壺",
  "placements": [
    {"slot": "main", "item": "白色耳機"},
    {"slot": "back", "item": "黑色水壺"}
  ],
  "remove": ["充電線"],
  "advice": "左下角的線收掉"
}
```

畫面上的框會自動換成 VLM 選的版型，
**而且框上的標籤變成實際的物品名稱**——
使用者看到的是「白色耳機」而不是「主商品」。

### 一個重要的架構改變：不再依賴物件偵測

原本規劃先用 COCO-SSD 抓物件框，再把清單送給 VLM 指派。

**放棄的理由：**
COCO-SSD 只認得 80 種常見物件，使用者手邊的東西
（耳機盒、保養品、公仔）它常常認不出來，而且標籤是英文的。

**現在的做法：**
讓 VLM 直接看圖回答「有什麼、哪個是主角、該擺哪」。

好處：
- 不受 COCO-SSD 的物件類別限制
- 回傳的是中文名稱，可以直接顯示在框上
- 少一層依賴，前端變輕

代價：
- 目前沒有「東西有沒有移進框裡」的即時判斷（那需要偵測框）
- 這是 1b 的事，如果時間夠再加

### 新的操作

| 按鍵 | 作用 |
| --- | --- |
| `1`~`4` | 直接切版型（同時鎖定） |
| `D` | 切換除錯面板 |
| `U` | 解除鎖定，交還給 VLM 自動判斷 |
| 點右上角標籤 | 循環切換版型 |

**除錯面板會顯示**畫布尺寸、目前版型、VLM 判讀的場景、
指派結果、延遲、失敗次數。框的位置如果還是怪，
按 `D` 看畫布尺寸對不對。

### 失敗處理

`chain.py` 依序嘗試 國網 → GMI → OpenAI，
每個 2.5 秒逾時。全部失敗回傳 `fallback`，
前端就繼續用目前的版型，**不報錯、不中斷**。

`remotePlanner` 連續失敗時會指數退讓，
間隔從 800ms 拉長到最多 8 秒，不會一直撞死掉的後端。

已驗證：沒有設定金鑰時 `/api/plan` 回傳
`{"fallback":true}` 而不是 500。

### 下一步

- 物件偵測 + 對齊判斷（東西移進框會變綠）
- 前後對比畫面
- 語音引導

---
## v0.8 · 2026-09-04 — Phase 1a：版型出現在相機畫面上

### 包含檔案

```
web/index.html                (改寫)
web/css/app.css               (改寫)
web/js/main.js                (新)
web/js/lib/config.js          (新)
web/js/lib/geometry.js        (新)
web/js/camera/camera.js       (新)
web/js/camera/frameLoop.js    (新)
web/js/ui/overlayCanvas.js    (新)
web/js/ui/hintBar.js          (新)
web/js/ui/layoutBadge.js      (新)
CHANGELOG.md
```

解壓覆蓋，重整瀏覽器即可。後端沒動，uvicorn 不用重啟。

### 現在能做什麼

開 `http://localhost:8000/` → 按「開始拍攝」→ 畫面出現目標框。

- 點右上角的版型標籤可以切換四種版型
- 電腦上按 `1` `2` `3` `4` 直接切（調座標時很方便）
- 按快門會下載目前畫面

**還沒有物件偵測**，所以框是靜態的。那是 1b 的事。

### 剩下的開發

| 階段 | 內容 | 產出 |
| --- | --- | --- |
| 1a ✅ | 相機 + 疊層 + 版型顯示 | 手機舉起來看得到框 |
| 1b | 物件偵測 + 規則指派 + 對齊判斷 | 東西移進框會變綠 |
| 1c | 快門 + 前後對比 | **離線可用的完整產品** |
| 2 | `nchc.py` + `chain.py` + `remotePlanner` | AI 修正版型 |
| 3 | 語音 + 商品文案 | Demo 演得出來 |
| 4 | 修 bug + 排練 + 備援影片 | 提交 |

**1a 到 1c 做完就有保命線了**，那時候不需要網路也能完整 Demo。

### 這一版的幾個設計

**啟動畫面是必要的，不是裝飾。**
iOS Safari 必須由使用者「主動點擊」才能開相機，
不能在頁面載入時自動啟動。所以一定要有一顆按鈕。

**`playsinline` 一定要有。**
沒有的話 iOS 會強制全螢幕播放影片，整個介面就毀了。

**座標的處理。**
video 用 `object-fit: cover` 填滿畫面，所以「看得到的區域」
就等於「canvas 的區域」，0~1 的座標可以直接乘畫布寬高。
1b 做物件偵測時要另外換算，因為送進模型的原始影像
長寬比可能和畫面不同（被 cover 裁掉了）。

**迴圈節流到 10fps。**
`requestAnimationFrame` 在手機上是 60fps，
物件偵測跑不了那麼快，而且會把電力和發熱拉滿。
使用者搬東西的速度遠慢於 10fps，完全夠用。

**版型標籤可以手動鎖定。**
使用者點過之後 AI 就不再自動改版型。
這不只是開發方便，是產品功能：AI 選的不一定合意。

**已接上熱身。**
頁面啟動時打一次 `/api/warmup`，
讓使用者的第一次真實請求不是最慢的那次。

### 已通過的測試

geometry 的 20 項：中心點、面積、像素轉換、夾範圍、IoU、
偏移計算、插值、COCO-SSD 格式轉換，以及四個版型的顏色對應。

### 調座標的建議做法

1. 電腦上開 `http://localhost:8000/`，按 `1`~`4` 切版型
2. 覺得哪個框位置怪，改 `web/js/layouts/definitions/*.js`
3. 重整就看得到

**現在改最便宜**，之後所有引導邏輯都建立在這些座標上。

---
## v0.7 · 2026-09-04 — 修正 main.py 被佔位檔覆蓋的 bug

### 包含檔案

```
server/main.py            (修正：完整內容)
scripts/scaffold.py       (修正：不再讓佔位檔搶先寫入)
CHANGELOG.md
```

**解壓後直接覆蓋，然後重新啟動 uvicorn 就好。**
不需要重跑 scaffold。

### 出了什麼問題

```
ERROR: Error loading ASGI app.
       Attribute "app" not found in module "server.main".
```

`scaffold.py` 的 `PY_FILES` 清單裡有 `server/main.py`，
而 `write()` 的規則是「已存在就跳過」。

執行順序變成：

```
1. for f in PY_FILES:  write("server/main.py", "# TODO")   ← 先寫了
2. write("server/main.py", MAIN_PY)                        ← 被跳過
```

所以你的 `main.py` 裡只有一行 `# TODO`，沒有 `app` 這個物件。

### 怎麼修的

在 `scaffold.py` 加了一組 `REAL_CONTENT` 集合，
列出所有有真實內容的路徑，寫佔位檔時一律排除：

```python
REAL_CONTENT = {
    "web/index.html", "web/css/app.css", "server/main.py",
    "requirements.txt", ".env.example", ".gitignore",
}
```

同時把完整的 `main.py` 嵌回 scaffold，
確保之後重跑 scaffold 產生的內容與正式版一致（已驗證 diff 相同）。

**只有 `server/main.py` 受影響**，其他檔案沒有這個重疊問題。

### main.py 這次寫了什麼

| 項目 | 說明 |
| --- | --- |
| `/api/health` | 確認後端活著 |
| `/api/warmup` | 熱身用，目前是空殼 |
| 500 錯誤處理 | 回傳 `fallback: true`，讓前端靜默降級 |
| 啟動時印出常用網址 | 省得每次去翻文件 |
| 找不到 `web/` 會警告 | 提醒你先跑 scaffold |

**掛載順序**已在註解裡標明：`StaticFiles` 掛在 `/` 會吃掉所有路徑，
所以 API 路由一定要先 `include_router`，靜態檔案最後才 `mount`。
順序反了 `/api/plan` 會回傳 404。

### 關於 warmup

實測冷啟動 1.4 秒、之後 0.3 秒。
前端在頁面載入時打一次 `/api/warmup`，
使用者的第一次真實請求就不會是最慢的那次。

目前是空殼，接上 `chain.py` 之後改成真的送一次假請求。

### 驗證方式

```powershell
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

啟動後應該看到：

```
SnapFit 啟動
  主程式      http://localhost:8000/
  版型預覽    http://localhost:8000/layouts-preview.html
  API 測試頁  http://localhost:8000/docs
```

然後開 `http://localhost:8000/api/health` 應回 `{"ok":true,...}`。

---
## v0.6 · 2026-09-04 — 操作手冊 + prompts + validate

### 包含檔案

```
docs/06-RUNBOOK.md              (新，複製貼上就能用的指令)
server/services/prompts.py      (改寫)
server/services/validate.py     (改寫)
CHANGELOG.md
```

### 穩定性測試的結論

| 發現 | 影響 |
| --- | --- |
| 同一張圖 8/8 完全一致 | `merge.js` **不需要遲滯**，省一塊工 |
| 兩張圖結果不同且各自穩定 | 模型確實在看圖，VLM 有保留價值 |
| 純白圖 8/8 判 `light: ok` | **`light` 欄位不可信，已從 prompt 移除** |
| 空值型別隨圖片改變 | `validate.py` 必須正規化，已實作 |

最後一項最陰險：場景圖回傳字串 `"null"`，純白圖回傳真正的 `null`。
字串 `"null"` 在 JavaScript 裡是**真值**，前端會拿它去找物件，
找不到，畫面就壞了。沒做這個測試不會發現。

### prompts.py 的兩個修正

**1. 拿掉 `light`**
亮度改由 `web/js/vision/quality.js` 在本機算平均亮度。
純數學，又快又準，離線也能用。

**2. 把指派優先序講清楚**
原本「高的放 back」和「面積最大當 main」會打架，
因為這兩個常常是同一個物件。現在明確規定先選主角、再排高度。

`angle` 保留但標為建議性質，我們沒真正驗證過它的準確度。
**前端不要用它擋流程**（不要因為 angle 不 ok 就禁止拍照）。

### validate.py 的設計原則

**該拒絕的整份拒絕，該忽略的只忽略。**

| 情況 | 處理 |
| --- | --- |
| 未知版型 id | 整份拒絕 |
| 幻覺出來的物件 id | 整份拒絕 |
| 同一物件佔兩個位置 | 整份拒絕 |
| 又指派又要求移除 | 整份拒絕 |
| 未知的 slot 名稱 | 忽略該項 |
| `remove` 裡有不存在的 id | 忽略該項 |
| `angle` 值非法 | 退回 `ok` |
| 缺少 `remove` 欄位 | 當成空陣列 |

拒絕時回傳 `None`，呼叫端退回上一個有效計畫或規則計畫。
**不報錯、不中斷，靜默降級。**

### 已通過的測試

18 項，包含兩種實測到的真實輸出、markdown 圍欄、
四道關卡、寬容處理、異常輸入、advice 與 listing 驗證器。

### 一個 Demo 前的提醒

冷啟動要 1.4 秒，熱了之後只要 0.3 秒。
**頁面載入時要送一次熱身請求**，
不然評審的第一次體驗會是最慢的那次。

### 下一步

`server/services/vlm/nchc.py` 與 `chain.py`，
把 `/api/plan` 端點串起來。

---
## v0.5 · 2026-09-04 — 穩定性檢測

### 包含檔案

```
scripts/check_stability.py   (新)
CHANGELOG.md
```

解壓到專案根目錄。`bench_vlm.py` 不變，這是獨立的一支。

### 為什麼需要這支

`bench_vlm.py` 只印第一次的輸出，所以看不出兩件事：

1. 同一張圖跑 10 次，指派結果到底一不一樣
2. 模型是真的在看圖，還是只在讀 detections 那份 JSON

白圖測試顯示輸出**有變**，但也可能只是模型本身不穩定，
兩次剛好各擲到一面。這支腳本用 A/B 對照直接分辨。

### 用法

```powershell
python scripts\check_stability.py        # 每組 8 次
python scripts\check_stability.py -n 12
```

跑兩組，detections 完全相同，只有影像不同：

- A 組：正常桌面場景圖
- B 組：純白圖

### 它會回答四個問題

| # | 問題 | 影響到什麼 |
| --- | --- | --- |
| 1 | 同一張圖的一致性 | `merge.js` 需不需要遲滯 |
| 2 | 模型有沒有真的看圖 | VLM 該不該保留、保留哪部分 |
| 3 | `light` 欄位可不可信 | 要不要改用 `quality.js` 本機算 |
| 4 | 空值用什麼型別 | `validate.py` 的正規化範圍 |

### 判讀後可能的三種調整

**如果不穩定（一致性 < 60%）**
版型與主角都以規則為準，VLM 只保留 `remove` 判斷。
這不是壞事，`rulePlanner` 本來就零延遲又穩定。

**如果沒在看圖（兩組結果完全相同）**
VLM 的價值只剩語意判斷（哪個是商品主角）。
`light` / `angle` 直接拿掉，改用 `quality.js` 算平均亮度，
那是純數學，又快又準，離線也能用。

**如果 light 不可信（純白圖大多判 ok）**
同上，光線判斷移到本機。

### 已知必修

`fingerprint()` 已內建正規化，把字串 `"null"` / `"none"` / `""`
視為真正的 `None`。**`validate.py` 要用同一套邏輯**，
因為模型的輸出在兩次之間型別就變過。

---
## v0.4 · 2026-09-04 — layouts 核心資產完成

### 包含檔案

```
web/js/layouts/schema.js                 (新)
web/js/layouts/assign.js                 (新)
web/js/layouts/index.js                  (新)
web/js/layouts/definitions/single.js     (新)
web/js/layouts/definitions/heroProps.js  (新)
web/js/layouts/definitions/flatlay.js    (新)
web/js/layouts/definitions/detail.js     (新)
web/layouts-preview.html                 (新，開發工具)
CHANGELOG.md
```

解壓到專案根目錄，覆蓋 scaffold 產生的同名佔位檔。

### 怎麼看成果

```powershell
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

開 `http://localhost:8000/layouts-preview.html`

**注意：一定要透過 uvicorn 開，不能直接雙擊 HTML 檔。**
原生 ES modules 在 `file://` 下會被瀏覽器擋掉。

這頁會做兩件事：

1. **畫出四個版型**，用顏色區分 slot 類型，虛線代表可空著
2. **指派模擬器** — 改物件的高度與面積，即時看規則怎麼指派

改完 `definitions/*.js` 重整就會更新，不用等相機那條線做完。

### 指派規則的優先序

順序很重要，弄反了結果會很怪：

```
1. 先挑主角   — 面積最大的那個 → hero slot
2. 再排剩下的 — 依高度排序，高的進 depth 小的位置（後面）
3. 位置不夠的 — 建議移除
```

**為什麼主角要先挑？**
因為「面積最大」和「高度最高」常常是同一個物件。
先排高度的話，最大的那個會被塞進 back，主角位置就空了。
（這正是 bench 測試時 VLM 犯的錯，prompt 沒把優先序講清楚。）

### 已通過的測試

- 四個版型定義驗證
- bench 測試圖情境（瓶子 + 書 + 雜線）
- 單一物件 → single
- 四個高度相近 → flatlay
- 高度排序正確進入對應 depth
- 未知版型 id 退回 single
- 空陣列不會爆

### 給 Phase 2 的提醒

規則與 VLM 對同一個場景可能給出**不同答案**。
以 bench 的測試圖為例：

| | main | back |
| --- | --- | --- |
| 規則 | d1 瓶子（面積最大） | d2 書 |
| VLM | d2 書 | d1 瓶子（最高） |

兩個都說得通。`merge.js` 要決定衝突時聽誰的。
建議：**版型選擇聽 VLM，主角選擇聽規則**，
因為主角是客觀的（面積最大），版型是語意的（需要理解場景）。

### 下一步

`server/services/prompts.py` 與 `validate.py`，
把 bench 發現的兩個問題修掉：字串 `"null"`、規則優先序沒講清楚。

---
## v0.3 · 2026-09-04 — bench_vlm.py 完成

### 包含檔案

```
scripts/bench_vlm.py     (改寫：從佔位檔變成完整可執行)
CHANGELOG.md             (本檔)
```

### 解壓方式

解壓到專案根目錄，覆蓋 `scripts/bench_vlm.py`。
其他檔案沿用 v0.2，不需要重新解壓。

### 這支腳本做什麼

Phase 0 的關卡。回答三個問題：

1. 從這台機器打得到國網嗎
2. 往返要多久（決定 Phase 2 的策略）
3. 模型吐得出乾淨的 JSON 嗎

**不需要先準備照片。** 腳本會自己生一張模擬桌面商品的測試圖，
刻意畫成「擺得不好」的樣子（高的在前、矮的在後、有雜物），
這樣才測得出模型會不會給出合理的重新指派。

### 用法

```powershell
python scripts\bench_vlm.py                 # 預設模型跑 10 次
python scripts\bench_vlm.py -n 20           # 跑 20 次
python scripts\bench_vlm.py --compare       # 比較三個候選模型
python scripts\bench_vlm.py --image my.jpg  # 用自己的照片
python scripts\bench_vlm.py --edge 384      # 把圖壓更小再測
```

### 判讀標準

| 中位數 | 判定 | 行動 |
| --- | --- | --- |
| < 1200ms | 很好 | 照原計畫，節流 1.5 秒 |
| 1200-2000ms | 可用但偏慢 | 節流拉到 2 秒，再測 Phi-4 |
| > 2000ms | 需要調整 | 換小模型 / 壓到 384 / 改停頓觸發 |

**超過 2000ms 不是災難。** `rulePlanner` 是零延遲的，
最壞情況只是 AI 修正變成偶爾發生，產品依然成立。

### 附帶功能

- `response_format` 不支援時會自動退回重試，並提示 `nchc.py` 要做 JSON 清洗
- 第一次就失敗會立刻停止，不浪費時間跑完 10 次
- 失敗時列出檢查清單（BASE_URL 要不要加 /v1、是否需要校內網路等）
- 會印出模型的實際輸出，可以直接判斷指派品質好不好

### 下一步

跑完把數字填進 `docs/02-ROADMAP.md` 的 Phase 0 實際紀錄，
然後告訴我結果，我開始寫 `layouts/` 那包。

---
## v0.2 · 2026-09-04 — 改為 venv + 純靜態前端

### 包含檔案

```
README.md                    (改寫：快速開始改為 venv 流程)
docs/01-ARCHITECTURE.md      (改寫：資料夾結構、技術選型全面更新)
docs/02-ROADMAP.md           (不變，一併附上方便對照)
docs/03-TODO.md              (不變)
docs/04-BACKLOG.md           (不變)
docs/05-DECISIONS.md         (新增 D11、D12)
scripts/scaffold.py          (新增：取代 scaffold.sh)
CHANGELOG.md                 (本檔)
```

### 解壓方式

直接解壓到專案根目錄，覆蓋同名檔案。

```powershell
# 解壓後刪掉舊的 shell 腳本
del scripts\scaffold.sh
```

### 這一版改了什麼

| 項目 | v0.1 | v0.2 |
| --- | --- | --- |
| 前端 | Vite + React (.jsx) | **純 HTML/CSS/JS (.js)** |
| 建置 | npm build | **不需要建置** |
| 前端目錄 | `web/src/` | `web/js/` |
| 伺服 | 前後端分開兩個 port | **FastAPI 同時提供 API 與靜態網站** |
| 骨架腳本 | `scaffold.sh` (bash) | **`scaffold.py` (跨平台)** |
| 依賴管理 | package.json + requirements.txt | **只有 requirements.txt** |

### 為什麼改

1. Windows / PyCharm 開發，bash 腳本跑不了
2. 之後要整個搬到樹莓派，沒有 build 步驟就能直接 rsync
3. 前後端同源，不用處理 CORS，Tunnel 只要開一條

詳見 `docs/05-DECISIONS.md` 的 D11。

### 下一步

1. 解壓後跑 `python scripts/scaffold.py`
2. 建立 venv、裝 requirements
3. **`docs/03-TODO.md` 裡標 🔴 的第一項：測國網 API 延遲**

---

## v0.1 · 2026-09-04 — 初版文件

專案文件初版：架構、路線圖、待辦、Backlog、決策紀錄。
（此版的 `scaffold.sh` 已由 v0.2 取代，可刪除）
# v0.33 — 提示閱讀時間與主體補光判斷

- 明確構圖指示至少停留 5 秒，背景判斷速度不變，只保留最新候選提示。
- 新增本機主體亮度／背光防線，補足 VLM 對偏暗畫面的漏判。
- 遠端光線分析仍僅由首次或持續的明顯光線變化觸發。
- 光線 Prompt 改為以主體細節可讀性為準，有氛圍不再等同不需補光。
