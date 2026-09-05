"""SnapFit 後端進入點。

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
from starlette.types import Scope

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

    送一張 1x1 的白圖出去，把連線與模型都叫醒。
    """
    from server.services import chain, prompts

    # 最小的合法 JPEG，內容不重要，目的只是建立連線
    tiny = (
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
        "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB"
        "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
    )
    r = await chain.ask(prompts.PLAN_SYSTEM, tiny,
                        "可用的版型：['single']", max_tokens=64)
    return {"ok": True, "warmed": r is not None,
            "provider": r.provider if r else None}


from server.routers import plan as plan_router

app.include_router(plan_router.router, prefix="/api", tags=["plan"])

# TODO: 之後接上
# from server.routers import advice, listing, voice


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

class NoCacheStatic(StaticFiles):
    """開發用的靜態檔案服務：一律不快取。

    ────────────────────────────────────────────────
    為什麼需要這個

    FastAPI 預設的 StaticFiles 只送 ETag 與 Last-Modified，
    不送 Cache-Control。瀏覽器遇到沒有 Cache-Control 的回應時
    會套用「啟發式快取」——自己決定一段時間內不重新驗證，
    連 304 都不問，直接用硬碟裡的舊檔案。

    這在開發時是災難。實際踩過兩次：

      v0.14  改了 app.css 修畫布尺寸，瀏覽器用舊 CSS，
             以為沒修好，多繞了一輪
      v0.21  config.js 新增 LIGHT_INTERVAL_MS，
             瀏覽器用舊的，該值變成 undefined，
             算出 NaN，光線路徑一次都沒被排到

    第二次特別陰險，因為它不會報錯，只是靜靜地不執行。

    加上 no-store 之後，每次重整一定拿到最新的檔案，
    不需要記得按 Ctrl + Shift + R。
    ────────────────────────────────────────────────
    """

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp


if WEB_DIR.exists():
    app.mount("/", NoCacheStatic(directory=WEB_DIR, html=True), name="web")
