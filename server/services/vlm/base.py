"""VLM provider 的共同介面。

所有 provider 都要實作 chat()。因為國網、GMI、OpenAI
都是 OpenAI 相容的端點，實作幾乎相同，差別只在 base_url 與模型名稱。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from server.config import settings


@dataclass
class VLMResult:
    text: str
    provider: str
    model: str
    latency_ms: int


class VLMProvider:
    name = "base"

    def available(self) -> bool:
        """金鑰有沒有設好。沒設好就跳過這個 provider。"""
        raise NotImplementedError

    async def chat(
        self, system: str, image_b64: str, user_text: str,
        max_tokens: int = 400, timeout_s: float = 2.5,
    ) -> VLMResult:
        raise NotImplementedError


class OpenAICompatible(VLMProvider):
    """OpenAI 相容端點的通用實作。

    國網中心走的就是這個格式，所以三家可以共用同一份程式碼。
    """

    def __init__(self, name: str, base_url: str, api_key: str, model: str):
        self.name = name
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self._client = None

    def available(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)

    def _client_lazy(self):
        # 延遲建立，避免沒設定的 provider 在啟動時就報錯
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(
                base_url=self.base_url or None, api_key=self.api_key
            )
        return self._client

    async def chat(
        self, system: str, image_b64: str, user_text: str,
        max_tokens: int = 400, timeout_s: float = 2.5,
    ) -> VLMResult:
        client = self._client_lazy()
        t0 = asyncio.get_event_loop().time()

        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {
                            "url": f"data:image/jpeg;base64,{image_b64}"}},
                        {"type": "text", "text": user_text},
                    ]},
                ],
                max_tokens=max_tokens,
                # 即時構圖是分類／控制訊號，不需要創作多樣性。降到 0
                # 可減少相鄰影格在同一畫面下給出不同方向的機率。
                temperature=settings.VLM_TEMPERATURE,
            ),
            timeout=timeout_s,
        )

        ms = int((asyncio.get_event_loop().time() - t0) * 1000)
        return VLMResult(
            text=resp.choices[0].message.content or "",
            provider=self.name,
            model=self.model,
            latency_ms=ms,
        )
