# 06 · 操作手冊

複製貼上就能用。所有指令都假設你在專案根目錄，且 venv 已啟動。

---

## 每天開工

```powershell
cd C:\Users\kevin\Desktop\個人-專案\競賽\2026_台灣未來祭_黑客松
.venv\Scripts\activate
```

提示字元前面出現 `(.venv)` 就代表成功了。

---

## 啟動服務

```powershell
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

| 參數 | 意義 |
| --- | --- |
| `--reload` | 改檔案自動重啟。開發時一定要加 |
| `--host 0.0.0.0` | 允許同網段的手機直接連。只寫 127.0.0.1 手機會連不到 |
| `--port 8000` | 換 port 的話記得 tunnel 也要跟著換 |

**停止：** 在該視窗按 `Ctrl + C`

---

## 常用網址

服務起來之後：

| 網址 | 用途 |
| --- | --- |
| `http://localhost:8000/` | 主程式 |
| `http://localhost:8000/layouts-preview.html` | 版型預覽與指派模擬器 |
| `http://localhost:8000/health` | 確認後端活著（應回 `{"ok":true}`） |
| `http://localhost:8000/docs` | FastAPI 自動生成的 API 測試頁 |

**注意：** HTML 一定要透過這個網址開，
不能直接雙擊檔案。原生 ES modules 在 `file://` 下會被瀏覽器擋掉。

---

## 手機測試

**先記住一件事：相機只能在「安全來源」下開啟。**

安全來源的定義是 HTTPS，或者 `localhost`。
`http://192.168.x.x:8000` 這種純 IP 的 HTTP **一律不行**，
瀏覽器會直接拒絕，而且錯誤訊息通常很難懂。

所以下面三個方法，只有前兩個能測相機。

### 方法 A：Cloudflare Tunnel（最通用）

**另開一個 PowerShell 視窗**（uvicorn 那個不要關）：

```powershell
python scripts\tunnel.py
```

它會起 tunnel、抓出網址、**直接在終端機印出 QR code**，
拿手機掃就能開，不用手動打那串亂碼網址。

同時會把 QR 存成 `assets/tunnel-qr.png`，
Demo 當天可以直接印出來貼在攤位上。

想要原始指令的話：

```powershell
cloudflared tunnel --url http://localhost:8000
```

沒裝的話：

```powershell
winget install --id Cloudflare.cloudflared
```

**注意：**每次重啟 tunnel 網址都會變。
Demo 當天要提早開好、把 QR code 印出來，不要臨場產生。

**如果你電腦上有 Cloudflare WARP 在跑**，先把它中斷。
WARP 是全流量 VPN，會和 tunnel 打架。

### 方法 B：USB 線 + Chrome 連接埠轉送（Android 專用，最快）

這個方法讓手機看到的網址是 `localhost`，屬於安全來源，
所以相機可以用，而且完全不依賴網路環境。

1. 手機開啟「開發人員選項」與「USB 偵錯」
2. 用 USB 線接電腦
3. 電腦的 Chrome 開 `chrome://inspect`
4. 點 **Port forwarding**，加一條 `8000` → `localhost:8000`，勾選啟用
5. 手機瀏覽器開 `http://localhost:8000`

**iPhone 沒有這個功能**，只能用方法 A。

### 方法 C：同網段直連（只能看版面，不能測相機）

```powershell
python scripts\net_check.py
```

這支會列出可用的 IP、檢查防火牆、偵測 VPN 干擾，
並告訴你該用哪個網址。

手機連同一個 Wi-Fi，開 `http://<列出的IP>:8000`。

**相機開不起來是正常的**，因為這是 HTTP。

### 手機連不上的三大原因

依照發生機率排序：

**1. Windows 防火牆（最常見）**

手機熱點會被 Windows 判定成「公用網路」，
而公用設定檔預設封鎖所有輸入連線。

用**系統管理員身分**開 PowerShell：

```powershell
New-NetFirewallRule -DisplayName "SnapFit 8000" -Direction Inbound `
  -Protocol TCP -LocalPort 8000 -Action Allow -Profile Any
```

`-Profile Any` 不能省，否則公用網路下還是會被擋。

**2. Cloudflare WARP 接管路由**

WARP 是全流量 VPN，常見副作用就是區域網路互連被切斷。
在系統匣的 WARP 圖示上按「中斷連線」再試。

**3. 手機熱點的用戶端隔離**

很多手機熱點預設禁止連上來的裝置互相通訊。
這個沒得改，直接用方法 A 或 B。

### 快速自我檢查

```powershell
# 服務有沒有綁對介面（應該看到 0.0.0.0:8000）
netstat -ano | Select-String ":8000"

# 從電腦自己用區域網路 IP 連連看
curl http://10.21.134.45:8000/api/health
```

如果 `curl` 用區域網路 IP 連得上，代表服務綁定正確，
問題就在防火牆或網路環境；連不上代表 uvicorn 少加了
`--host 0.0.0.0`。

## 診斷

### 測 VLM 延遲

```powershell
python scripts\bench_vlm.py              # 預設模型跑 10 次
python scripts\bench_vlm.py -n 20
python scripts\bench_vlm.py --compare    # 比較多個候選模型
python scripts\bench_vlm.py --edge 384   # 圖壓更小再測
python scripts\bench_vlm.py --image my.jpg
```

### 連線診斷

```powershell
python scripts\net_check.py
python scripts\net_check.py --port 8000
```

手機連不到時跑這支，一次檢查完服務綁定、可用 IP、
防火牆規則、網路設定檔、VPN 干擾。

### 測穩定性與影像依賴

```powershell
python scripts\check_stability.py
python scripts\check_stability.py -n 12
```

### 重建骨架（安全，不會覆蓋既有檔案）

```powershell
python scripts\scaffold.py
```

### 抓第三方函式庫的本機副本

```powershell
python scripts\fetch_vendor.py
```

**Demo 前一定要跑這個。** 會場 Wi-Fi 塞住時，
TF.js 從 CDN 載不下來的話連物件偵測都做不了。

---

## 套件管理

```powershell
pip install -r requirements.txt      # 安裝
pip install <套件名>                  # 加新套件
pip freeze > requirements.txt        # 更新清單（小心，會寫入全部）
```

**建議手動編輯 `requirements.txt`** 而不是用 `pip freeze`，
因為 freeze 會把一堆間接依賴也寫進去，之後很難維護。

---

## 常見問題

### 手機開不了相機

依序檢查：

1. 網址是 `https://` 嗎？（`http://` 除了 localhost 以外都不行）
2. 瀏覽器有沒有跳出權限詢問？被拒絕過的話要去設定裡改
3. iOS Safari 需要使用者「主動點擊」才能啟動相機，
   不能在頁面載入時自動開

### 改了 JS 沒反應

`--reload` 只監看 Python。前端要**手動重整**，
而且瀏覽器會快取，用 `Ctrl + Shift + R` 強制重整。

### `ModuleNotFoundError: No module named 'server'`

沒在專案根目錄跑。`cd` 回根目錄再試。

### uvicorn 說 port 被佔用

```powershell
netstat -ano | Select-String ":8000"
taskkill /PID <上面查到的PID> /F
```

### VLM 呼叫失敗

```powershell
python scripts\bench_vlm.py -n 1
```

腳本失敗時會列出檢查清單。最常見的是
`NCHC_BASE_URL` 結尾要不要加 `/v1`。

### 版型預覽頁一片空白

打開瀏覽器的開發者工具（F12）看 Console。
多半是 `import` 少寫了 `.js` 副檔名——
原生 ES modules 不像打包工具會自動補。

---

## 搬到樹莓派

```bash
# 在 Pi 上
git clone <repo>          # 或直接 rsync 整個資料夾
cd snapfit
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # 填入金鑰
python scripts/fetch_vendor.py
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

**因為前端沒有 build 步驟，不需要在 Pi 上跑 npm。**
這是當初選擇不用打包工具最實際的好處。

### 讓它開機自動啟動

```bash
sudo nano /etc/systemd/system/snapfit.service
```

```ini
[Unit]
Description=SnapFit
After=network.target

[Service]
User=user
WorkingDirectory=/home/user/snapfit
ExecStart=/home/user/snapfit/.venv/bin/uvicorn server.main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now snapfit
sudo systemctl status snapfit
journalctl -u snapfit -f      # 看即時 log
```

---

## Demo 當天的啟動順序

```powershell
# 1. 啟動服務
.venv\Scripts\activate
uvicorn server.main:app --host 0.0.0.0 --port 8000

# 2. 另開視窗，啟動 tunnel
cloudflared tunnel --url http://localhost:8000

# 3. 拿到網址後，用自己手機先完整測一次

# 4. 確認離線模式能用（把 Wi-Fi 關掉試）
```

**檢查清單：**

- [ ] `fetch_vendor.py` 已跑過，TF.js 有本機副本
- [ ] QR code 已印出（不要臨場產生）
- [ ] 用**別人的手機**測過
- [ ] 開飛航模式測過 `rule` 模式
- [ ] 備援影片存在本機（不是雲端）
- [ ] 頁面載入時有送出一次熱身請求
      （冷啟動要 1.4 秒，熱了之後只要 0.3 秒）
