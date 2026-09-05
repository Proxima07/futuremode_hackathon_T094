#!/usr/bin/env python3
"""
穩定性與影像依賴性檢測。

bench_vlm.py 只印第一次的輸出，看不出模型到底穩不穩、
也看不出它有沒有真的在看圖。這支腳本回答三個問題：

  1. 同一張圖跑 N 次，指派結果一致嗎？
     → 不一致的話，merge.js 需要更強的遲滯（hysteresis），
       否則畫面上的框會一直跳。

  2. 換成純白圖，結果會不一樣嗎？
     → 會 = 模型有在看圖
     → 不會 = 模型只是在讀 detections，那我們不需要 VLM

  3. light / angle 這兩個欄位可信嗎？
     → 純白圖是完全過曝的。如果模型還說 light 是 ok，
       這個欄位就是編的，不要拿來做 UI。

用法:
    python scripts/check_stability.py           # 每組跑 8 次
    python scripts/check_stability.py -n 12
    python scripts/check_stability.py -m Microsoft-Phi-4-multimodal-instruct
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    from openai import OpenAI
    from PIL import Image
except ImportError as e:
    print(f"缺少套件: {e}\n請先跑: pip install -r requirements.txt")
    sys.exit(1)

load_dotenv(ROOT / ".env")

# 直接沿用 bench_vlm 的素材與 prompt，確保測的是同一件事
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "_bench", ROOT / "scripts" / "bench_vlm.py"
)
_bench = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bench)


def encode(img: Image.Image, edge: int) -> str:
    img = img.copy()
    img.thumbnail((edge, edge))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82)
    return base64.b64encode(buf.getvalue()).decode()


def fingerprint(obj: dict) -> str:
    """把一次回應壓成一個可比較的字串，忽略無關的欄位順序。"""
    assign = obj.get("assign") or {}
    # 正規化字串 "null" / "none" / "" 為真正的 None
    norm = {}
    for k, v in assign.items():
        if isinstance(v, str) and v.strip().lower() in ("null", "none", ""):
            v = None
        norm[k] = v
    parts = [
        f"layout={obj.get('layout')}",
        "assign=" + ",".join(f"{k}:{norm[k]}" for k in sorted(norm)),
        "remove=" + ",".join(sorted(obj.get("remove") or [])),
    ]
    return " | ".join(parts)


def run_group(client, model, img_b64, n, title):
    print(f"\n{'─' * 66}\n{title}\n{'─' * 66}")

    fps, lights, angles, raw_null_types = [], [], [], Counter()

    for i in range(n):
        _, text, err = _bench.run_once(client, model, img_b64, True)
        if err:
            print(f"  {i+1:2d}. 失敗 {err[:60]}")
            continue
        try:
            obj = json.loads(_bench.clean_json(text))
        except Exception:
            print(f"  {i+1:2d}. JSON 解析失敗")
            continue

        fp = fingerprint(obj)
        fps.append(fp)
        lights.append(obj.get("light"))
        angles.append(obj.get("angle"))

        # 記錄空值到底是用什麼型別表示的
        for v in (obj.get("assign") or {}).values():
            if v is None:
                raw_null_types["JSON null"] += 1
            elif isinstance(v, str) and v.strip().lower() in ("null", "none", ""):
                raw_null_types[f'字串 "{v}"'] += 1

        print(f"  {i+1:2d}. {fp}")

    if not fps:
        return None

    counts = Counter(fps)
    top, top_n = counts.most_common(1)[0]
    consistency = top_n / len(fps)

    print(f"\n  不同結果數：{len(counts)} 種 / {len(fps)} 次")
    print(f"  最常出現：{top_n}/{len(fps)}  ({consistency:.0%})")
    if len(counts) > 1:
        for fp, c in counts.most_common()[1:]:
            print(f"    另有 {c} 次：{fp}")

    print(f"  light  分布：{dict(Counter(lights))}")
    print(f"  angle  分布：{dict(Counter(angles))}")
    if raw_null_types:
        print(f"  空值型別：{dict(raw_null_types)}")

    return {
        "counts": counts,
        "top": top,
        "consistency": consistency,
        "lights": Counter(lights),
        "null_types": raw_null_types,
        "n": len(fps),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=8, help="每組測試次數")
    ap.add_argument("-m", "--model")
    ap.add_argument("--edge", type=int,
                    default=int(os.getenv("IMAGE_MAX_EDGE", "512")))
    args = ap.parse_args()

    base_url = os.getenv("NCHC_BASE_URL", "").strip()
    api_key = os.getenv("NCHC_API_KEY", "").strip()
    if not base_url or not api_key:
        print("✗ .env 裡的 NCHC_BASE_URL 或 NCHC_API_KEY 是空的。")
        return 1

    model = args.model or os.getenv("NCHC_MODEL", "gemma-4-26B-A4B-it")
    client = OpenAI(base_url=base_url, api_key=api_key, timeout=30.0)

    scene = encode(_bench.make_test_image(), args.edge)
    white = encode(Image.new("RGB", (512, 512), "white"), args.edge)

    print(f"模型：{model}   每組 {args.n} 次")
    print("送出的 detections 兩組完全相同，只有影像不同。")

    a = run_group(client, model, scene, args.n, "A 組 · 正常桌面場景圖")
    b = run_group(client, model, white, args.n, "B 組 · 純白圖（同一份 detections）")

    if not a or not b:
        print("\n測試無法完成。")
        return 1

    # ── 判讀 ──────────────────────────────────────
    print(f"\n{'=' * 66}\n判讀\n{'=' * 66}")

    # 問題 1：穩不穩
    print("\n【1】同一張圖的一致性")
    worst = min(a["consistency"], b["consistency"])
    if worst >= 0.85:
        print(f"    穩定（{worst:.0%}）。merge.js 用一般的過渡就好。")
    elif worst >= 0.6:
        print(f"    普通（{worst:.0%}）。merge.js 需要遲滯：")
        print("    連續兩次得到同一個新結果才切換，避免框跳來跳去。")
    else:
        print(f"    不穩（{worst:.0%}）。這個決定模型基本上在擲骰子。")
        print("    建議：主角與版型都以規則為準，VLM 只用來判斷 remove。")

    # 問題 2：有沒有看圖
    overlap = set(a["counts"]) & set(b["counts"])
    same_top = a["top"] == b["top"]
    print("\n【2】模型有沒有真的在看圖")
    if same_top and len(overlap) == len(a["counts"]) == len(b["counts"]):
        print("    兩組結果完全相同 → 模型很可能沒在看圖，")
        print("    只是在讀 detections 這份 JSON。")
        print("    如果是這樣，VLM 的價值只剩語意判斷（哪個是商品主角），")
        print("    light / angle 直接拿掉，改用 quality.js 本機算。")
    elif same_top:
        print("    主要結果相同但分布有差 → 影像的影響很弱。")
        print("    可以保留 VLM，但不要依賴它做視覺判斷。")
    else:
        print("    兩組主要結果不同 → 模型確實有參考影像。")
        print("    不過仍要看上面第 1 點：如果本身就不穩，")
        print("    這個差異也可能只是隨機。")

    # 問題 3：light 可不可信
    print("\n【3】light 欄位可不可信")
    white_lights = b["lights"]
    ok_ratio = white_lights.get("ok", 0) / max(1, sum(white_lights.values()))
    if ok_ratio > 0.5:
        print(f"    純白圖有 {ok_ratio:.0%} 判定為 ok → 這個欄位不可信。")
        print("    純白是完全過曝，模型應該要抓到才對。")
        print("    建議：light 改用 quality.js 在本機算平均亮度，")
        print("    那是純數學，又快又準，而且離線也能用。")
    else:
        print(f"    純白圖只有 {ok_ratio:.0%} 判定為 ok → 這個欄位可以用。")

    # 問題 4：null 型別
    print("\n【4】空值的型別")
    allt = a["null_types"] + b["null_types"]
    if len(allt) > 1:
        print(f"    出現多種表示法：{dict(allt)}")
        print('    validate.py 必須把 "null" / "none" / "" 正規化成 None。')
    elif allt:
        print(f"    一致使用 {list(allt)[0]}，但仍建議做正規化防禦。")
    else:
        print("    這幾次沒有出現空值，無法判斷。")

    print(f"\n{'=' * 66}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
