"""OpenAI。最後保底。"""

from server.config import settings
from server.services.vlm.base import OpenAICompatible


def make() -> OpenAICompatible:
    return OpenAICompatible(
        name="openai",
        base_url="",           # 用官方預設端點
        api_key=settings.OPENAI_API_KEY,
        model=settings.OPENAI_MODEL,
    )
