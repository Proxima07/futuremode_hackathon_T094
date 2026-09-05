"""Provider 串接與 fallback。

行為：
    國網 (2.5s timeout) → 失敗 → GMI → 失敗 → OpenAI → 全失敗 → None

回傳 None 時，router 會回傳 fallback 給前端，
前端繼續用規則版型，不報錯、不中斷。
"""

from __future__ import annotations

import asyncio
import logging

from server.config import settings
from server.services.vlm import gmi, nchc, openai_provider
from server.services.vlm.base import VLMProvider, VLMResult

log = logging.getLogger("snapfit.chain")

_FACTORIES = {
    "nchc": nchc.make,
    "gmi": gmi.make,
    "openai": openai_provider.make,
}

_providers: list[VLMProvider] | None = None


def providers() -> list[VLMProvider]:
    """依照 .env 的順序建立 provider，只保留設定齊全的。"""
    global _providers
    if _providers is None:
        out = []
        for name in settings.PROVIDER_CHAIN:
            factory = _FACTORIES.get(name)
            if not factory:
                log.warning("未知的 provider：%s", name)
                continue
            p = factory()
            if p.available():
                out.append(p)
            else:
                log.info("跳過 %s（金鑰或模型未設定）", name)
        _providers = out
        log.info("可用的 provider：%s",
                 [p.name for p in out] or "無")
    return _providers


async def ask(system: str, image_b64: str, user_text: str,
              max_tokens: int = 400,
              timeout_ms: int | None = None) -> VLMResult | None:
    """依序嘗試每個 provider，第一個成功的就回傳。

    timeout_ms 可以逐次覆寫。主路徑要快，逾時設短一點；
    動態版型生成本來就慢，可以放寬。
    """
    timeout_s = (timeout_ms or settings.TIMEOUT_MS) / 1000

    for p in providers():
        try:
            return await p.chat(system, image_b64, user_text,
                                max_tokens=max_tokens, timeout_s=timeout_s)
        except asyncio.TimeoutError:
            log.warning("%s 逾時（>%.1fs）", p.name, timeout_s)
        except Exception as e:
            log.warning("%s 失敗：%s", p.name, e)

    return None
