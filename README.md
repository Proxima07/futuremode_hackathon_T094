# SnapFit

> 別的 App 教你怎麼拍，SnapFit 告訴你東西該怎麼擺。

FUTUREMODE / BUILDMODE 2026 參賽專案
賽道：**Track 02 · AI for Everyday Life 日常生活 AI**

---

## 這是什麼

一個**免安裝的網頁應用**，使用者用手機瀏覽器打開，鏡頭對準桌上的商品，
畫面上會即時疊出**目標框**，告訴他每一樣東西該擺到哪個位置。

使用者不需要懂攝影，他只需要**把東西移進框裡**。

對齊之後拍下的照片，構圖一定是對的，因為框的位置來自預先設計好的
**版型 (layout)**，不是 AI 臨場亂給的座標。

### 目標使用者

二手交易 / 網拍賣家。他們的痛點不是「照片不夠美」，
而是「照片拍不好，東西賣不掉、賣不到好價錢」。

「好看」是主觀的，但「能賣掉」是客觀的。這是我們把場景限定在
商品照的原因。

---

## 核心設計：三個決定

### 1. 按「速度」分層，不是按「功能」分層

| | 快層 | 慢層 |
| --- | --- | --- |
| 回答的問題 | 東西**現在**在哪、對齊了沒 | 東西**應該**在哪 |
| 跑在哪 | 手機瀏覽器（本機） | 遠端 VLM |
| 頻率 | 每 100ms | 每 1.5 秒 |

使用者搬東西的時候，「應該擺哪」是不變的，變的只有「現在在哪」。
所以慢層算一次，快層可以用好幾秒。這是延遲問題的解法。

### 2. 版型優先，AI 只做指派

AI 不生成座標，只做選擇題：**挑哪個版型、哪個物件放哪個位置、哪個該移除。**

輸出從一堆浮點數變成幾個 id，token 少一個量級，延遲明顯下降，
而且框永遠不會亂跳。

### 3. 規則先跑，AI 後修正

「高放後、低放前」用純規則就能算，零延遲。
打開相機**立刻**就有框可以對，AI 回來之後再平滑地修正。

**這代表：AI 全掛掉，產品照樣能用。**

---

## 文件導覽

| 文件 | 內容 | 什麼時候看 |
| --- | --- | --- |
| [`docs/01-ARCHITECTURE.md`](docs/01-ARCHITECTURE.md) | 資料夾結構逐層說明、資料流、介面定義 | 開工前、找不到檔案該放哪時 |
| [`docs/02-ROADMAP.md`](docs/02-ROADMAP.md) | 五個階段的目標、範圍、驗收標準、風險 | 每天早上、決定現在該做什麼時 |
| [`docs/03-TODO.md`](docs/03-TODO.md) | 可勾選的待辦清單 | 隨時 |
| [`docs/04-BACKLOG.md`](docs/04-BACKLOG.md) | 這次不做、之後可以做的 | 想加功能時（先去看有沒有被列為「不做」） |
| [`docs/05-DECISIONS.md`](docs/05-DECISIONS.md) | 技術決策紀錄與理由 | 想推翻某個設計時 |

---

## 快速開始

前端是**純 HTML/CSS/JS，沒有 build 步驟**，
所以整個專案只需要一個 Python 環境。

### Windows / PyCharm

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python scripts\scaffold.py          # 建立資料夾骨架，可重複執行
copy .env.example .env               # 填入國網的 BASE_URL 與 API_KEY
python scripts\fetch_vendor.py      # 抓 TF.js 本機副本（離線備援）
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

開 `http://localhost:8000` 即可。**前後端同一個 port。**

### 樹莓派

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

因為沒有 build 步驟，直接 rsync 整個資料夾過去就能跑。

### 手機測試

手機瀏覽器要開相機**必須是 HTTPS**（localhost 例外）：

```bash
cloudflared tunnel --url http://localhost:8000
```

## 現在的狀態

**Phase 0 · 地基**（進行中）

下一個動作：跑 `scripts/bench_vlm.py` 測國網延遲，
以及把 `web/src/layouts/definitions/` 的四個版型座標寫出來。

詳見 [`docs/02-ROADMAP.md`](docs/02-ROADMAP.md)。
