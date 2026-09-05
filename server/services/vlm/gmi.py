"""GMI Cloud。備援，同時也是贊助商（評分項）。"""

from server.config import settings
from server.services.vlm.base import OpenAICompatible


def make() -> OpenAICompatible:
    return OpenAICompatible(
        name="gmi",
        base_url=settings.GMI_BASE_URL,
        api_key=settings.GMI_API_KEY,
        model=settings.GMI_MODEL,
    )
