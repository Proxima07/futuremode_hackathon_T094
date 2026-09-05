"""API 的請求與回應格式。

前後端的契約定在這裡，改這裡就要同步改 web/js/lib/api.js。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── 請求 ────────────────────────────────────────────

class SlotIn(BaseModel):
    """目前版型的一個位置。讓 VLM 知道現在的框長什麼樣，
    才能判斷合不合用。"""
    id: str
    box: list[float]
    prefer: str = "any"
    label: str = ""
    anchor: list[float] | None = None
    guide: str = ""


class LayoutIn(BaseModel):
    """目前正在用的版型。"""
    id: str
    name: str = ""
    guide_only: bool = False
    composition: str = ""
    orientation: str = ""
    slots: list[SlotIn] = []


class Exposure(BaseModel):
    """本機算出來的曝光統計。

    這些是客觀數字，用來補上 VLM 的盲點：
    它對絕對亮度沒有參照基準（純白圖也會說 ok），
    但拿到數字之後就能做出正確的方向性判斷。

    數值都是 0~1。
    """
    mean: float = 0.5          # 整體平均亮度
    clipped_high: float = 0.0  # 過曝（接近純白）的像素比例
    clipped_low: float = 0.0   # 死黑的像素比例
    left: float = 0.5          # 左半邊平均亮度
    right: float = 0.5
    top: float = 0.5
    bottom: float = 0.5

    # 主體與背景分開算。這是判斷背光的關鍵。
    # 場地裡有一盞強燈就會把整張畫面的左右數字拉爆，
    # 但那跟使用者要拍的東西無關。
    subject: float = 0.5        # 目標框內的平均亮度
    background: float = 0.5     # 目標框外的平均亮度
    subject_ratio: float = 1.0  # 主體/背景。< 0.55 通常是背光

    # 反差。亮度的標準差，高 = 硬光，低 = 平光。
    # 少了這個，模型只能猜「光太硬」還是「光太平」。
    contrast: float = 0.15

    # 顏色。少了這些，模型分不出「色偏」和「風格」——
    # 夜店的藍光和餐廳的暖黃燈在亮度上看起來都像不理想，
    # 但它們是風格。
    warmth: float = 0.0         # -1 冷（藍）~ +1 暖（橙）
    saturation: float = 0.2     # 平均飽和度
    hue_spread: float = 0.0     # 色相散布 0~1，高代表多色光源混雜
    dominant_hue: float = -1.0  # 主色相 0~360，-1 代表沒有明顯顏色
    color_ratio: float = 0.0    # 有明顯顏色的像素比例


class PlanRequest(BaseModel):
    """POST /api/plan — 版型判斷與物品配置。每次循環都會呼叫。"""
    image: str = Field(..., description="base64 JPEG，長邊已壓到 512")
    layouts: list[str] = Field(..., description="允許的內建版型 id")
    intent: str = Field(default="secondhand_listing")
    current: LayoutIn | None = Field(
        default=None, description="目前正在用的版型，用來判斷合不合用")


class LightRequest(BaseModel):
    """POST /api/light — 光線分析。

    獨立成一個端點，因為房間的光線幾秒內不會變，
    不需要跟著物品位置一起每次重算。
    """
    image: str
    intent: str = "product"
    exposure: Exposure | None = None


class CustomRequest(BaseModel):
    """POST /api/custom — 動態版型生成。

    只在 /api/plan 回報 fit=custom 時才呼叫。
    座標很吃 token，放在主路徑是純浪費。
    """
    image: str
    intent: str = "product"
    current: LayoutIn | None = None


# ── 回應 ────────────────────────────────────────────

class Placement(BaseModel):
    slot: str
    item: str


class CustomSlot(BaseModel):
    id: str
    box: list[float]
    depth: int = 0
    prefer: str = "any"
    label: str = ""


class CustomLayout(BaseModel):
    name: str = "臨時版型"
    slots: list[CustomSlot] = []


class Adjust(BaseModel):
    """對既有版型的受約束調整。不是自由座標。"""
    mirror: bool = False
    flip_y: bool = False
    scale: float = 1.0
    shift_x: float = 0.0
    shift_y: float = 0.0


class Light(BaseModel):
    """光線分析。這是 VLM 的語意判斷，本機算不出來。"""
    verdict: str = "ok"       # ok / too_dark / too_bright / backlit / harsh / flat
    source: str = "unknown"   # left / right / top / front / back / mixed / unknown
    fill_from: str = "none"   # left / right / front / top / none
    shoot_from: str = "keep"  # overhead / high_45 / eye_level / low / keep
    advice: str = ""          # 一句具體的人話


class PlanResponse(BaseModel):
    fit: str = "good"         # good / adjust / custom
    layout: str = ""
    adjust: Adjust | None = None
    custom: CustomLayout | None = None
    scene: str = ""
    placements: list[Placement] = []
    remove: list[str] = []
    light: Light | None = None
    advice: str = ""
    source: str = "vlm"
    latency_ms: int = 0


class PlanFallback(BaseModel):
    fallback: bool = True
    reason: str = ""
