"""VLM 回應的清洗與驗證。

原則：**該拒絕的整份拒絕，該修正的就修正，該忽略的只忽略。**

動態版型（custom）是最需要防呆的部分。模型可能吐出：
  - 超出畫面或超出安全區的框
  - 彼此重疊到看不清楚的框
  - 太小（對不準）或太大（沒有引導意義）的框
  - 沒有主角的版型
  - 一堆位置但畫面根本放不下

這些大多是可以「修」的，不需要整份丟掉。修不好才退回。
"""

from __future__ import annotations

import json
import re
from typing import Any

NULLISH = {"null", "none", "nil", "n/a", "na", "-", ""}

FITS = {"good", "adjust", "custom"}
PREFERS = {"hero", "tall_or_large", "short_or_small", "any"}
PLAN_PHASES = {"searching", "guiding"}
ALIGNMENTS = {"move", "ready", "lost"}
GUIDANCE_ACTIONS = {
    "none", "move_left", "move_right", "move_up", "move_down",
    "move_closer", "move_farther", "rotate_clockwise",
    "rotate_counterclockwise", "reframe",
}

# 三級判定，不是只有「好」和「壞」。
# stylish 是刻意保留的：夜店藍光、餐廳暖黃燈、黃昏側逆光
# 在數字上都像「不理想」，但那是風格不是缺陷。
LIGHT_VERDICT = {"good", "stylish", "problem"}

LIGHT_ISSUE = {"none", "too_dark", "too_bright", "backlit", "harsh", "flat"}

LIGHT_ENV = {
    "daylight_indoor", "daylight_outdoor", "golden_hour", "overcast",
    "warm_indoor", "cool_indoor", "neon", "lowlight", "mixed", "unknown",
}
LIGHT_SOURCE = {"left", "right", "top", "front", "back", "mixed", "unknown"}
LIGHT_FILL = {"left", "right", "front", "top", "none"}
LIGHT_SHOOT = {"overhead", "high_45", "eye_level", "low", "keep"}

# 安全區。上方有版型標籤，下方有提示條與快門。
SAFE_TOP, SAFE_BOTTOM = 0.12, 0.76
SAFE_LEFT, SAFE_RIGHT = 0.04, 0.96

MIN_SLOT_AREA = 0.02      # 太小的框使用者對不準
MAX_SLOT_AREA = 0.72      # 太大的框沒有引導意義
MAX_SLOTS = 5
MAX_PAIR_IOU = 0.55       # 兩個框重疊超過這個比例就視為看不清

_FENCE_OPEN = re.compile(r"^```[a-zA-Z]*\s*\n?")
_FENCE_CLOSE = re.compile(r"\n?```\s*$")


# ── 基礎工具 ────────────────────────────────────────

def strip_fence(text: str) -> str:
    t = (text or "").strip()
    t = _FENCE_OPEN.sub("", t)
    t = _FENCE_CLOSE.sub("", t)
    return t.strip()


def norm(value: Any) -> str | None:
    """把各種「空」的表示法統一成 None。

    實測發現模型會在不同輸入下回傳字串 "null" 或真正的 null，
    而字串 "null" 在 JavaScript 裡是真值，不清掉前端會壞。
    """
    if not isinstance(value, str):
        return None
    v = value.strip()
    return None if v.lower() in NULLISH else v


def enum(value: Any, allowed: set[str], default: str) -> str:
    v = norm(value)
    return v if v in allowed else default


def num(value: Any, lo: float, hi: float, default: float) -> float:
    try:
        return max(lo, min(hi, float(value)))
    except (TypeError, ValueError):
        return default


def flag(value: Any) -> bool:
    """容忍模型把 JSON boolean 寫成字串，避免 "false" 被 bool() 當 true。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return isinstance(value, str) and value.strip().lower() in {
        "true", "1", "yes", "on",
    }


def parse_json(text: str) -> dict | None:
    if not text:
        return None
    raw = strip_fence(text)
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except (json.JSONDecodeError, TypeError):
        pass
    # 模型偶爾會在 JSON 前後多寫幾個字，撈出大括號區塊再試一次
    start, end = raw.find("{"), raw.rfind("}")
    if 0 <= start < end:
        try:
            obj = json.loads(raw[start:end + 1])
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    return None


# ── 框的幾何 ────────────────────────────────────────

def _area(b: list[float]) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _iou(a: list[float], b: list[float]) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    return inter / (_area(a) + _area(b) - inter)


def _fix_box(raw: Any) -> list[float] | None:
    """把一個框修進安全區。修不動就回 None。"""
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        x1, y1, x2, y2 = (float(v) for v in raw)
    except (TypeError, ValueError):
        return None

    # 座標順序顛倒的話交換回來
    if x1 > x2:
        x1, x2 = x2, x1
    if y1 > y2:
        y1, y2 = y2, y1

    # 夾進安全區
    x1 = max(SAFE_LEFT, min(x1, SAFE_RIGHT))
    x2 = max(SAFE_LEFT, min(x2, SAFE_RIGHT))
    y1 = max(SAFE_TOP, min(y1, SAFE_BOTTOM))
    y2 = max(SAFE_TOP, min(y2, SAFE_BOTTOM))

    box = [x1, y1, x2, y2]
    a = _area(box)
    if a < MIN_SLOT_AREA or a > MAX_SLOT_AREA:
        return None
    return [round(v, 4) for v in box]


# ── 動態版型 ────────────────────────────────────────

def validate_custom(raw: Any) -> dict | None:
    """驗證並修正 VLM 生成的版型。

    修得動的就修，修不動的丟掉那一個位置。
    最後至少要留下一個位置，而且要有主角。
    """
    if not isinstance(raw, dict):
        return None

    slots_in = raw.get("slots")
    if not isinstance(slots_in, list) or not slots_in:
        return None

    slots: list[dict] = []
    seen_ids: set[str] = set()

    for i, s in enumerate(slots_in):
        if len(slots) >= MAX_SLOTS:
            break
        if not isinstance(s, dict):
            continue

        box = _fix_box(s.get("box"))
        if box is None:
            continue

        sid = norm(s.get("id")) or f"s{i + 1}"
        if sid in seen_ids:
            sid = f"{sid}_{i}"
        seen_ids.add(sid)

        # 和已接受的框重疊太多就丟掉，不然畫面看不清楚
        if any(_iou(box, k["box"]) > MAX_PAIR_IOU for k in slots):
            continue

        slots.append({
            "id": sid,
            "box": box,
            "depth": int(num(s.get("depth"), 0, 9, len(slots))),
            "prefer": enum(s.get("prefer"), PREFERS, "any"),
            "label": (norm(s.get("label")) or "")[:6],
        })

    if not slots:
        return None

    # 一定要有且只有一個主角。沒有就把面積最大的那個升格。
    heroes = [s for s in slots if s["prefer"] == "hero"]
    if not heroes:
        max(slots, key=lambda s: _area(s["box"]))["prefer"] = "hero"
    elif len(heroes) > 1:
        keep = max(heroes, key=lambda s: _area(s["box"]))
        for s in heroes:
            if s is not keep:
                s["prefer"] = "any"

    return {
        "name": (norm(raw.get("name")) or "臨時版型")[:8],
        "slots": slots,
    }


# ── 主驗證 ──────────────────────────────────────────

def validate_plan(raw: dict | None, allowed_layouts: set[str],
                  layout_slots: dict[str, list[str]],
                  allow_custom: bool = True,
                  current: dict | None = None,
                  phase: str = "searching") -> dict | None:
    """驗證並清洗擺放計畫。

    Args:
        current: 前端目前正在用的版型。動態版型被拒絕、
                 而模型又沒給有效的內建版型 id 時，
                 用它當退路，這樣至少能保住光線建議與物品配置。
                 光線建議跟版型無關，不該被連坐丟掉。
    """
    if not isinstance(raw, dict):
        return None

    phase = phase if phase in PLAN_PHASES else "searching"
    if phase == "guiding" and not (current and norm(current.get("id"))):
        return None
    fit = enum(raw.get("fit"), FITS, "good")

    # ── 動態版型 ─────────────────────────────
    custom = None
    if fit == "custom" and allow_custom:
        custom = validate_custom(raw.get("custom"))
        if custom is None:
            fit = "good"        # 生成失敗就退回沿用現有版型
    elif fit == "custom":
        fit = "good"

    # ── 內建版型 ─────────────────────────────
    layout = norm(raw.get("layout"))
    if layout not in allowed_layouts:
        if fit == "custom":
            layout = ""         # 用動態版型時不需要內建 id
        elif current and norm(current.get("id")):
            # 沒給有效版型，但知道前端現在用什麼，就沿用
            layout = norm(current.get("id"))
            fit = "good"
        else:
            return None

    # GUIDING 的構圖已經定案。就算模型又提出新版型或新座標，也只把它
    # 當作對準判斷，後端先固定回目前版型，前端再做第二層保護。
    if phase == "guiding" and current and norm(current.get("id")):
        layout = norm(current.get("id"))
        fit = "good"
        custom = None

    # ── 微調參數 ─────────────────────────────
    adjust = None
    if fit == "adjust":
        a = raw.get("adjust") if isinstance(raw.get("adjust"), dict) else {}
        adjust = {
            "mirror": flag(a.get("mirror")),
            "flip_y": flag(a.get("flip_y")),
            "scale": num(a.get("scale"), 0.85, 1.20, 1.0),
            "shift_x": num(a.get("shift_x"), -0.08, 0.08, 0.0),
            "shift_y": num(a.get("shift_y"), -0.08, 0.08, 0.0),
        }
        # identity adjust 不能自動改成 good。當目前版型已翻向時，模型會用
        # identity 明確要求回到內建基準；改成 good 反而會保留上一輪方向。

    # ── 物品配置 ─────────────────────────────
    if custom:
        valid_slots = {s["id"] for s in custom["slots"]}
    elif phase == "guiding" and current:
        valid_slots = {s["id"] for s in current.get("slots", [])}
    elif layout in layout_slots:
        valid_slots = set(layout_slots[layout])
    elif current:
        # 沿用前端目前版型的位置
        valid_slots = {
            norm(s.get("id")) for s in (current.get("slots") or [])
            if norm(s.get("id"))
        }
    else:
        valid_slots = set()

    placements, used = [], set()
    raw_placements = raw.get("placements")
    for p in (raw_placements if isinstance(raw_placements, list) else []):
        if not isinstance(p, dict):
            continue
        slot = norm(p.get("slot"))
        item = norm(p.get("item"))
        if not slot or not item or slot not in valid_slots or slot in used:
            continue
        used.add(slot)
        placements.append({
            "slot": slot, "item": item[:10],
            "feature": (norm(p.get("feature")) or "")[:14],
        })

    # 鎖定的不只是座標，也包括對準部位，避免「杯標」忽然變成「杯蓋」。
    if phase == "guiding" and current:
        targets = {s["id"]: s for s in current.get("slots", [])}
        for p in placements:
            target = targets.get(p["slot"], {})
            p["item"] = (norm(target.get("item")) or p["item"])[:10]
            p["feature"] = (norm(target.get("feature")) or p["feature"])[:14]

    remove = []
    raw_remove = raw.get("remove")
    for r in (raw_remove if isinstance(raw_remove, list) else []):
        v = norm(r)
        if v and v not in remove:
            remove.append(v[:10])
        if len(remove) >= 5:
            break

    # ── 引導是否完成 ──────────────────────────
    alignment = enum(raw.get("alignment"), ALIGNMENTS, "move")
    action = enum(raw.get("action"), GUIDANCE_ACTIONS, "reframe")
    advice = (norm(raw.get("advice")) or "")[:30]

    # 還有明確雜物要移除、或根本沒有辨識到主體時，不得宣告可拍攝。
    primary_slots = {"main", "person", "detail"} & valid_slots
    if phase == "guiding" and current:
        primary_slots = {s["id"] for s in current.get("slots", [])
                         if s.get("prefer") == "hero"} or primary_slots
    has_subject = bool(placements) and (
        not primary_slots or any(p["slot"] in primary_slots for p in placements)
    )
    if not has_subject:
        alignment = "lost"
        placements = []
    elif alignment == "ready" and remove:
        alignment = "move"
    if alignment == "ready":
        action = "none"
        advice = ""
    elif alignment == "lost":
        action = "none"
        advice = ""
    elif action == "none":
        action = "reframe"

    # ── 光線 ────────────────────────────────
    lr = raw.get("light") if isinstance(raw.get("light"), dict) else {}
    light = {
        "verdict": enum(lr.get("verdict"), LIGHT_VERDICT, "ok"),
        "source": enum(lr.get("source"), LIGHT_SOURCE, "unknown"),
        "fill_from": enum(lr.get("fill_from"), LIGHT_FILL, "none"),
        "shoot_from": enum(lr.get("shoot_from"), LIGHT_SHOOT, "keep"),
        "advice": (norm(lr.get("advice")) or "")[:30],
    }
    # 光線沒問題就不要建議補光，避免自相矛盾
    if light["verdict"] == "ok" and light["fill_from"] != "none":
        light["fill_from"] = "none"

    return {
        "fit": fit,
        "layout": layout,
        "adjust": adjust,
        "custom": custom,
        "scene": (norm(raw.get("scene")) or "")[:24],
        "placements": placements,
        "remove": remove,
        "alignment": alignment,
        "action": action,
        "ready_to_capture": alignment == "ready",
        "light": light,
        "advice": advice,
        "source": "vlm",
    }


def validate_light(raw: dict | None) -> dict | None:
    """光線分析的驗證。/api/light 專用。

    除了列舉值比對，還要壓掉幾種自相矛盾的輸出：
      - 有風格卻同時指出偏暗：保留問題與補光建議
      - 說有問題卻沒填 issue：保留提醒，不自動降級為光線良好
      - 缺少有效判斷：回傳 None，不能當作 good
    """
    if not isinstance(raw, dict):
        return None

    # 舊版相容：模型可能還是回傳舊的 verdict 值
    raw_verdict = norm(raw.get("verdict")) or ""
    if raw_verdict in LIGHT_ISSUE and raw_verdict != "none":
        # 直接給了問題類型，當成 problem 處理
        verdict, issue = "problem", raw_verdict
    elif raw_verdict == "ok":
        verdict, issue = "good", enum(raw.get("issue"), LIGHT_ISSUE, "none")
    else:
        if raw_verdict not in LIGHT_VERDICT:
            return None
        verdict = raw_verdict
        issue = enum(raw.get("issue"), LIGHT_ISSUE, "none")

    light = {
        "env": enum(raw.get("env"), LIGHT_ENV, "unknown"),
        "verdict": verdict,
        "issue": issue,
        "source": enum(raw.get("source"), LIGHT_SOURCE, "unknown"),
        "fill_from": enum(raw.get("fill_from"), LIGHT_FILL, "none"),
        "shoot_from": enum(raw.get("shoot_from"), LIGHT_SHOOT, "keep"),
        "mood": (norm(raw.get("mood")) or "")[:10],
        # tip 是新名字，advice 是舊的，兩個都收
        "tip": (norm(raw.get("tip")) or norm(raw.get("advice")) or "")[:34],
    }

    # ── 壓掉自相矛盾 ──────────────────────────
    if light["issue"] != "none":
        light["verdict"] = "problem"
    if light["verdict"] != "problem":
        light["fill_from"] = "none"
    elif not light["tip"]:
        light["tip"] = {
            "too_dark": "保留環境色調，從正面加一點柔光照亮主體",
            "backlit": "保留背後輪廓光，從正面少量補光",
            "too_bright": "減弱直射主體的光，保留亮部細節",
            "harsh": "用白紙在暗側反光，柔化主體陰影",
            "flat": "讓光從側面照主體，增加明暗層次",
        }.get(light["issue"], "先確認主體亮暗與細節，再調整光線")
    if light["issue"] in {"too_dark", "backlit"} and light["fill_from"] == "none":
        light["fill_from"] = "front"

    return light


def validate_listing(raw: dict | None) -> dict | None:
    if not isinstance(raw, dict):
        return None
    title = norm(raw.get("title"))
    if not title:
        return None
    desc = norm(raw.get("description")) or ""
    tags = raw.get("tags")
    tags = ([t.strip() for t in tags if isinstance(t, str) and t.strip()][:8]
            if isinstance(tags, list) else [])
    return {"title": title[:40], "description": desc, "tags": tags}
