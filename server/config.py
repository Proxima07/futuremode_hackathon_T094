"""設定。從 .env 讀取，全部集中在這裡。"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, "") or default)
    except ValueError:
        return default


def _float(key: str, default: float) -> float:
    try:
        return float(os.getenv(key, "") or default)
    except ValueError:
        return default


class Settings:
    # Provider 優先序，由左到右 fallback
    PROVIDER_CHAIN = [
        s.strip()
        for s in os.getenv("VLM_PROVIDER_CHAIN", "nchc").split(",")
        if s.strip()
    ]
    TIMEOUT_MS = _int("VLM_TIMEOUT_MS", 2500)
    VLM_TEMPERATURE = max(0.0, min(1.0, _float("VLM_TEMPERATURE", 0.0)))
    IMAGE_MAX_EDGE = _int("IMAGE_MAX_EDGE", 512)

    NCHC_BASE_URL = os.getenv("NCHC_BASE_URL", "").strip()
    NCHC_API_KEY = os.getenv("NCHC_API_KEY", "").strip()
    NCHC_MODEL = os.getenv("NCHC_MODEL", "gemma-4-26B-A4B-it").strip()

    GMI_BASE_URL = os.getenv("GMI_BASE_URL", "").strip()
    GMI_API_KEY = os.getenv("GMI_API_KEY", "").strip()
    GMI_MODEL = os.getenv("GMI_MODEL", "").strip()

    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()


settings = Settings()
