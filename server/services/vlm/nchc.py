"""國網中心。OpenAI 相容端點，所以直接沿用通用實作。"""

from server.config import settings
from server.services.vlm.base import OpenAICompatible


def make() -> OpenAICompatible:
    return OpenAICompatible(
        name="nchc",
        base_url=settings.NCHC_BASE_URL,
        api_key=settings.NCHC_API_KEY,
        model=settings.NCHC_MODEL,
    )
