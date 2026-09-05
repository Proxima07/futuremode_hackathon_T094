"""VLM 相關端點。

拆成三條路徑，依「變化速度」而不是依平行度：

    /api/plan    版型判斷 + 物品配置。物品一直在動，每次都要算
    /api/light   光線分析。房間的光幾秒不會變，5 秒一次就夠
    /api/custom  動態版型。一百次可能用到一次，需要時才呼叫

拆開是為了讓每次的輸出變小（token 數直接決定延遲），
不是為了平行呼叫——平行只會讓同一個端點負擔加倍。

任何一條路徑失敗都回傳 fallback，前端維持現狀，不中斷。
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter

from server.models.schemas import CustomRequest, LightRequest, PlanRequest
from server.services import chain, prompts, validate

log = logging.getLogger("snapfit.plan")
router = APIRouter()

# 各內建版型有哪些位置。要和 web/js/layouts/definitions/*.js 一致。
LAYOUT_SLOTS = {
    "single": ["main"],
    "hero_props": ["back", "main", "front"],
    "flatlay": ["main", "s1", "s2", "s3", "s4"],
    "detail": ["detail"],
    "overhead": ["main", "s1", "s2"],
    "angle45": ["back", "main", "front"],
    "rule_thirds": ["main", "secondary"],
    "golden_grid": ["main", "secondary"],
    "golden_spiral": ["main", "flow"],
    "triangle": ["main", "left", "right"],
    "diagonal": ["main", "secondary"],
    "portrait_environment": ["person"],
    "portrait_center": ["person"],
}


def _elapsed(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


@router.post("/plan")
async def plan(req: PlanRequest):
    """主路徑。輸出刻意壓小，因為每次循環都會呼叫。"""
    t0 = time.perf_counter()

    allowed = set(req.layouts) & set(LAYOUT_SLOTS)
    if not allowed:
        return {"fallback": True, "reason": "沒有可用的版型"}

    current = req.current.model_dump() if req.current else None
    result = await chain.ask(
        prompts.PLAN_SYSTEM,
        req.image,
        prompts.plan_text(req.intent, sorted(allowed), current),
        max_tokens=250,
    )
    if result is None:
        return {"fallback": True, "reason": "所有 provider 都失敗"}

    clean = validate.validate_plan(
        validate.parse_json(result.text), allowed, LAYOUT_SLOTS,
        allow_custom=False,      # 動態版型走 /api/custom
        current=current,
    )
    if clean is None:
        log.warning("plan 驗證失敗：%s", (result.text or "")[:200])
        return {"fallback": True, "reason": "回應格式不正確"}

    # 主路徑不做動態版型，只回報「需要」，前端再去打 /api/custom
    raw_fit = (validate.parse_json(result.text) or {}).get("fit")
    clean["needs_custom"] = validate.norm(raw_fit) == "custom"

    clean["latency_ms"] = _elapsed(t0)
    clean["provider"] = result.provider
    return clean


@router.post("/light")
async def light(req: LightRequest):
    """光線分析。獨立路徑，前端用比較慢的節奏呼叫。"""
    t0 = time.perf_counter()

    result = await chain.ask(
        prompts.LIGHT_SYSTEM,
        req.image,
        prompts.light_text(
            req.intent,
            req.exposure.model_dump() if req.exposure else None,
        ),
        max_tokens=160,
    )
    if result is None:
        return {"fallback": True, "reason": "所有 provider 都失敗"}

    clean = validate.validate_light(validate.parse_json(result.text))
    if clean is None:
        log.warning("light 驗證失敗：%s", (result.text or "")[:200])
        return {"fallback": True, "reason": "回應格式不正確"}

    clean["latency_ms"] = _elapsed(t0)
    return clean


@router.post("/custom")
async def custom(req: CustomRequest):
    """動態版型生成。只在 /api/plan 回報 needs_custom 時呼叫。

    座標輸出量大，逾時放寬到 8 秒——反正它很少被呼叫，
    而且失敗了前端就繼續用現有版型，不影響體驗。
    """
    t0 = time.perf_counter()

    result = await chain.ask(
        prompts.CUSTOM_SYSTEM,
        req.image,
        prompts.custom_text(
            req.intent,
            req.current.model_dump() if req.current else None,
        ),
        max_tokens=420,
        timeout_ms=8000,
    )
    if result is None:
        return {"fallback": True, "reason": "所有 provider 都失敗"}

    parsed = validate.parse_json(result.text) or {}
    layout = validate.validate_custom(parsed)
    if layout is None:
        log.warning("custom 驗證失敗：%s", (result.text or "")[:200])
        return {"fallback": True, "reason": "生成的版型不合格"}

    valid_slots = {s["id"] for s in layout["slots"]}
    placements, used = [], set()
    for p in (parsed.get("placements") or []):
        if not isinstance(p, dict):
            continue
        slot = validate.norm(p.get("slot"))
        item = validate.norm(p.get("item"))
        if not slot or not item or slot not in valid_slots or slot in used:
            continue
        used.add(slot)
        placements.append({"slot": slot, "item": item[:10]})

    return {
        "custom": layout,
        "placements": placements,
        "latency_ms": _elapsed(t0),
        "provider": result.provider,
    }
