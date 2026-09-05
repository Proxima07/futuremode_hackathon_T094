#!/usr/bin/env python3
"""
SnapFit 專案骨架產生器（跨平台）

用法:
    python scripts/scaffold.py

特性:
    - Windows / Linux / macOS 都能跑，不需要 bash
    - 可重複執行，已存在的檔案不會被覆蓋
    - 前端為純 HTML/CSS/JS，不需要 Node
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- 目錄
DIRS = [
    "docs",
    "scripts",
    "assets/voice",
    # 前端：純靜態，由 FastAPI 掛載
    "web/css",
    "web/js/state",
    "web/js/camera",
    "web/js/vision",
    "web/js/layouts/definitions",
    "web/js/planner",
    "web/js/guidance",
    "web/js/ui",
    "web/js/lib",
    "web/js/vendor",
    "web/img",
    # 後端
    "server/routers",
    "server/services/vlm",
    "server/models",
]

# ---------------------------------------------------------------- 佔位檔
JS_FILES = [
    "web/js/main.js",
    "web/js/state/sessionMachine.js",
    "web/js/camera/camera.js",
    "web/js/camera/frameLoop.js",
    "web/js/vision/detector.js",
    "web/js/vision/quality.js",
    "web/js/vision/alignment.js",
    "web/js/layouts/index.js",
    "web/js/layouts/schema.js",
    "web/js/layouts/assign.js",
    "web/js/layouts/definitions/single.js",
    "web/js/layouts/definitions/heroProps.js",
    "web/js/layouts/definitions/flatlay.js",
    "web/js/layouts/definitions/detail.js",
    "web/js/planner/index.js",
    "web/js/planner/rulePlanner.js",
    "web/js/planner/remotePlanner.js",
    "web/js/planner/merge.js",
    "web/js/guidance/phrases.js",
    "web/js/guidance/voice.js",
    "web/js/guidance/toInstruction.js",
    "web/js/ui/cameraView.js",
    "web/js/ui/overlayCanvas.js",
    "web/js/ui/hintBar.js",
    "web/js/ui/shutterButton.js",
    "web/js/ui/layoutBadge.js",
    "web/js/ui/resultCompare.js",
    "web/js/lib/api.js",
    "web/js/lib/geometry.js",
    "web/js/lib/config.js",
]

PY_FILES = [
    "server/config.py",
    "server/routers/plan.py",
    "server/routers/advice.py",
    "server/routers/listing.py",
    "server/routers/voice.py",
    "server/services/vlm/base.py",
    "server/services/vlm/nchc.py",
    "server/services/vlm/gmi.py",
    "server/services/vlm/openai_provider.py",
    "server/services/chain.py",
    "server/services/prompts.py",
    "server/services/validate.py",
    "server/services/tts.py",
    "server/models/schemas.py",
    "scripts/bench_vlm.py",
    "scripts/pregen_voice.py",
    "scripts/fetch_vendor.py",
]

PKG_INIT = [
    "server/__init__.py",
    "server/routers/__init__.py",
    "server/services/__init__.py",
    "server/services/vlm/__init__.py",
    "server/models/__init__.py",
]

# ---------------------------------------------------------------- 內容範本
INDEX_HTML = """<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>SnapFit</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <div id="app">
    <video id="camera" playsinline autoplay muted></video>
    <canvas id="overlay"></canvas>
    <div id="hint"></div>
    <button id="shutter" disabled>拍照</button>
  </div>

  <!-- 本機優先，抓不到再退回 CDN。執行 scripts/fetch_vendor.py 建立本機副本 -->
  <script src="/js/vendor/tf.min.js"
          onerror="this.onerror=null;this.src='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js'"></script>
  <script src="/js/vendor/coco-ssd.min.js"
          onerror="this.onerror=null;this.src='https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'"></script>

  <!-- 我們自己的程式碼走原生 ES modules，不需要打包工具 -->
  <script type="module" src="/js/main.js"></script>
</body>
</html>
"""

APP_CSS = """/* SnapFit — 手機直式優先 */
* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  background: #0b0b0d;
  color: #f2f2f4;
  font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif;
  overflow: hidden;
}

#app { position: relative; width: 100vw; height: 100dvh; }

#camera  { width: 100%; height: 100%; object-fit: cover; }
#overlay { position: absolute; inset: 0; pointer-events: none; }

#hint {
  position: absolute; left: 50%; bottom: 128px;
  transform: translateX(-50%);
  padding: 10px 18px; border-radius: 999px;
  background: rgba(0, 0, 0, .62);
  font-size: 17px; white-space: nowrap;
}

#shutter {
  position: absolute; left: 50%; bottom: 40px;
  transform: translateX(-50%);
  width: 72px; height: 72px; border-radius: 50%;
  border: 4px solid rgba(255, 255, 255, .9);
  background: #fff; color: transparent;
  transition: opacity .2s;
}
#shutter:disabled { opacity: .35; }
"""

MAIN_PY = '''"""SnapFit 後端進入點。

同時負責兩件事：
  1. /api/*  提供 VLM 相關端點
  2. /       把 web/ 當靜態網站掛上去

第 2 點讓前後端同源，不需要處理 CORS，
Cloudflare Tunnel 也只要開一條。

────────────────────────────────────────────────
掛載順序很重要。

StaticFiles 掛在 "/" 會吃掉所有路徑，
所以 API 路由一定要先 include_router，靜態檔案最後才 mount。
順序反了的話 /api/plan 會回傳 404。
────────────────────────────────────────────────

啟動：
    uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("snapfit")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("SnapFit 啟動")
    log.info("  主程式      http://localhost:8000/")
    log.info("  版型預覽    http://localhost:8000/layouts-preview.html")
    log.info("  API 測試頁  http://localhost:8000/docs")

    if not WEB_DIR.exists():
        log.warning("找不到 web/ 資料夾，先跑 python scripts/scaffold.py")

    yield
    log.info("SnapFit 關閉")


app = FastAPI(title="SnapFit", version="0.7", lifespan=lifespan)


# ── API 路由（一定要在 StaticFiles 之前） ──────────────────

@app.get("/api/health")
async def health():
    """確認後端活著。"""
    return {"ok": True, "service": "snapfit"}


@app.post("/api/warmup")
async def warmup():
    """熱身。

    實測冷啟動要 1.4 秒，之後只要 0.3 秒。
    前端在頁面載入時打一次這裡，
    使用者的第一次真實請求就不會是最慢的那次。

    目前是空殼，接上 chain.py 之後改成真的送一次假請求。
    """
    return {"ok": True, "warmed": False}


# TODO: Phase 2 接上
# from server.routers import plan, advice, listing, voice
# app.include_router(plan.router,    prefix="/api", tags=["plan"])
# app.include_router(advice.router,  prefix="/api", tags=["advice"])
# app.include_router(listing.router, prefix="/api", tags=["listing"])
# app.include_router(voice.router,   prefix="/api", tags=["voice"])


@app.exception_handler(500)
async def on_error(request, exc):
    """後端出錯時回傳結構化訊息，讓前端能靜默降級。

    前端拿到 fallback=True 就繼續用規則版型，不要顯示錯誤畫面。
    """
    log.exception("未處理的錯誤：%s", exc)
    return JSONResponse(
        status_code=500,
        content={"ok": False, "fallback": True, "detail": str(exc)},
    )


# ── 靜態網站（一定要最後掛載） ───────────────────────────

if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
'''

REQUIREMENTS = """# --- 核心 ---
fastapi==0.115.6
uvicorn[standard]==0.34.0
pydantic==2.10.4
python-dotenv==1.0.1

# --- 呼叫 VLM（國網為 OpenAI 相容端點，共用同一個 SDK） ---
openai==1.59.6
httpx==0.28.1

# --- 影像處理（送給 VLM 前壓縮） ---
pillow==11.1.0

# --- 開發輔助 ---
python-multipart==0.0.20

# --- Tunnel 的 QR code（scripts/tunnel.py） ---
qrcode==8.0
"""

ENV_EXAMPLE = """# Provider 優先序，逗號分隔，由左到右 fallback
VLM_PROVIDER_CHAIN=nchc,gmi,openai
VLM_TIMEOUT_MS=6000

# 國網中心（OpenAI 相容端點）
NCHC_BASE_URL=
NCHC_API_KEY=
NCHC_MODEL=gemma-4-26B-A4B-it

# GMI Cloud（贊助商，備援）
GMI_BASE_URL=
GMI_API_KEY=
GMI_MODEL=

# OpenAI（最後保底）
OPENAI_API_KEY=
OPENAI_MODEL=

# ElevenLabs（僅用於商品描述朗讀，非即時引導）
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

# 送給 VLM 的影像長邊上限
IMAGE_MAX_EDGE=512
"""

GITIGNORE = """.env
.venv/
venv/
__pycache__/
*.pyc
.idea/
assets/voice/*.mp3
web/js/vendor/*.js
.DS_Store
"""


# ---------------------------------------------------------------- 執行
# 這些路徑有真實內容（見下方 write 呼叫），絕對不能被佔位檔搶先寫入。
# v0.6 曾因為 server/main.py 同時出現在 PY_FILES 與真實內容中，
# 佔位檔先寫導致真正的 main.py 被跳過，uvicorn 找不到 app。
REAL_CONTENT = {
    "web/index.html",
    "web/css/app.css",
    "server/main.py",
    "requirements.txt",
    ".env.example",
    ".gitignore",
}

created, skipped = [], []


def write(rel: str, content: str) -> None:
    path = ROOT / rel
    if path.exists():
        skipped.append(rel)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    created.append(rel)


def main() -> int:
    print(f"→ 在 {ROOT} 建立骨架\n")

    for d in DIRS:
        (ROOT / d).mkdir(parents=True, exist_ok=True)

    for f in JS_FILES:
        if f not in REAL_CONTENT:
            write(f, "// TODO\n")
    for f in PY_FILES:
        if f not in REAL_CONTENT:
            write(f, "# TODO\n")
    for f in PKG_INIT:
        write(f, "")

    write("web/index.html", INDEX_HTML)
    write("web/css/app.css", APP_CSS)
    write("server/main.py", MAIN_PY)
    write("requirements.txt", REQUIREMENTS)
    write(".env.example", ENV_EXAMPLE)
    write(".gitignore", GITIGNORE)
    write("assets/voice/.gitkeep", "")
    write("web/js/vendor/.gitkeep", "")

    for f in sorted(created):
        print(f"  + {f}")
    if skipped:
        print(f"\n  ({len(skipped)} 個檔案已存在，未覆蓋)")

    print(f"\n✓ 完成：新增 {len(created)} 個檔案\n")
    print("下一步：")
    print("  1. python -m venv .venv")
    print("  2. .venv\\Scripts\\activate         (Windows)")
    print("     source .venv/bin/activate      (Linux / Pi)")
    print("  3. pip install -r requirements.txt")
    print("  4. copy .env.example .env  並填入國網的 BASE_URL 與 API_KEY")
    print("  5. python scripts/fetch_vendor.py   ← 抓 TF.js 本機副本（離線備援）")
    print("  6. python scripts/bench_vlm.py      ← Phase 0 的關卡：測延遲")
    print("  7. uvicorn server.main:app --reload --host 0.0.0.0 --port 8000")
    return 0


if __name__ == "__main__":
    sys.exit(main())
