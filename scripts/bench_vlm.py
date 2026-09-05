#!/usr/bin/env python3
"""
Phase 0 關卡：測 VLM 往返延遲。

這是整個專案第一個要跑的東西。它回答三個問題：
  1. 從這台機器打得到國網嗎？
  2. 往返要多久？（決定 Phase 2 的策略）
  3. 模型吐得出乾淨的 JSON 嗎？

用法:
    python scripts/bench_vlm.py                    # 用預設模型跑 10 次
    python scripts/bench_vlm.py -n 20              # 跑 20 次
    python scripts/bench_vlm.py -m Microsoft-Phi-4-multimodal-instruct
    python scripts/bench_vlm.py --compare          # 一次比較多個模型
    python scripts/bench_vlm.py --image my.jpg     # 用自己的照片測
    python scripts/bench_vlm.py --edge 384         # 改變送出的解析度

判讀:
    中位數 < 1200ms  → 很好，可以做到即時自動更新
    1200 - 2000ms    → 可用，把節流拉到 2 秒
    > 2000ms         → 改成「使用者停頓才觸發」，或換小模型
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    from openai import OpenAI
    from PIL import Image, ImageDraw
except ImportError as e:
    print(f"缺少套件: {e}\n請先跑: pip install -r requirements.txt")
    sys.exit(1)

load_dotenv(ROOT / ".env")


# ----------------------------------------------------------------- 測試素材
def make_test_image(width: int = 512, height: int = 512) -> Image.Image:
    """畫一張模擬桌面商品場景的圖，省得你還要先去拍照。

    刻意畫成「擺得不好」的樣子：主體偏左下、有雜物、高低沒有層次。
    這樣才測得出模型會不會給出合理的重新指派。
    """
    img = Image.new("RGB", (width, height), (232, 228, 220))
    d = ImageDraw.Draw(img)

    # 桌面陰影，讓畫面不要太平
    d.rectangle([0, int(height * 0.72), width, height], fill=(214, 208, 198))

    # 高瓶子（應該被放到後面）——目前卻在前方右側
    d.rectangle([int(width * .60), int(height * .34),
                 int(width * .74), int(height * .78)], fill=(58, 92, 74))
    d.rectangle([int(width * .645), int(height * .27),
                 int(width * .695), int(height * .35)], fill=(44, 70, 56))

    # 矮的書本（應該在前面）——目前卻在左後方
    d.rectangle([int(width * .16), int(height * .52),
                 int(width * .46), int(height * .66)], fill=(176, 82, 62))
    d.line([int(width * .16), int(height * .56),
            int(width * .46), int(height * .56)], fill=(150, 66, 50), width=3)

    # 雜物：一條線（模型應該建議移除）
    d.line([int(width * .04), int(height * .93),
            int(width * .34), int(height * .88)], fill=(70, 70, 74), width=7)

    # 小配件
    d.ellipse([int(width * .80), int(height * .80),
               int(width * .90), int(height * .90)], fill=(120, 118, 130))
    return img


def to_b64(img: Image.Image, max_edge: int) -> tuple[str, int]:
    """壓到指定長邊並轉 base64。回傳 (base64, 位元組數)。"""
    img = img.copy()
    img.thumbnail((max_edge, max_edge))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82)
    raw = buf.getvalue()
    return base64.b64encode(raw).decode(), len(raw)


# 對應測試圖的偵測結果。實際執行時這來自 COCO-SSD。
DETECTIONS = [
    {"id": "d1", "label": "bottle", "box": [0.60, 0.27, 0.74, 0.78],
     "h_ratio": 0.51, "area": 0.07},
    {"id": "d2", "label": "book", "box": [0.16, 0.52, 0.46, 0.66],
     "h_ratio": 0.14, "area": 0.04},
    {"id": "d3", "label": "cable", "box": [0.04, 0.88, 0.34, 0.93],
     "h_ratio": 0.05, "area": 0.02},
]

LAYOUTS = ["single", "hero_props", "flatlay", "detail"]

SYSTEM_PROMPT = """你是商品攝影的構圖助手。

你會收到一張桌面照片、畫面上偵測到的物件清單，以及可選的版型清單。

版型說明：
- single：單一主體，畫面只有一樣東西時用
- hero_props：主角加配件，有高低層次。slot 為 back / main / front
- flatlay：平拍等距排列，物件三個以上且高度相近時用。slot 為 s1..s4
- detail：單一區域填滿，拍瑕疵或材質特寫時用。slot 為 detail

指派規則：
1. 高的、大的物件放 back（較後方的 slot）
2. 矮的、小的物件放 front
3. 面積最大或最有商品價值的當 main
4. 線材、垃圾、與商品無關的雜物放進 remove

只輸出 JSON，不要任何說明文字，不要 markdown 圍欄。格式：
{"layout":"<版型id>","assign":{"<slotid>":"<物件id或null>"},
 "remove":["<物件id>"],"light":"ok|too_dark|backlit",
 "angle":"ok|too_high|too_low"}"""


def clean_json(text: str) -> str:
    """模型有時會包 markdown 圍欄，先剝掉再 parse。"""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    return t.strip()


# ----------------------------------------------------------------- 測試主體
def run_once(client: OpenAI, model: str, img_b64: str,
             use_json_mode: bool) -> tuple[float, str | None, str | None]:
    """跑一次。回傳 (毫秒, 回應文字, 錯誤訊息)。"""
    payload = json.dumps(
        {"detections": DETECTIONS, "layouts": LAYOUTS,
         "intent": "secondhand_listing"},
        ensure_ascii=False,
    )

    kwargs = dict(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": [
                {"type": "image_url",
                 "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
                {"type": "text", "text": payload},
            ]},
        ],
        max_tokens=300,
        temperature=0.2,
    )
    if use_json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    t0 = time.perf_counter()
    try:
        resp = client.chat.completions.create(**kwargs)
        ms = (time.perf_counter() - t0) * 1000
        return ms, resp.choices[0].message.content, None
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        return ms, None, f"{type(e).__name__}: {e}"


def bench(client: OpenAI, model: str, img_b64: str, kb: int,
          n: int, use_json_mode: bool) -> dict | None:
    print(f"\n{'=' * 62}")
    print(f"模型: {model}")
    print(f"影像: {kb:.1f} KB   次數: {n}   "
          f"json_mode: {'開' if use_json_mode else '關'}")
    print("=" * 62)

    times, ok_json, first_valid, last_err = [], 0, None, None

    for i in range(1, n + 1):
        ms, text, err = run_once(client, model, img_b64, use_json_mode)

        if err:
            last_err = err
            print(f"  {i:2d}. 失敗 ({ms:6.0f} ms)  {err[:70]}")
            # 第一次就失敗多半是設定問題，不用再跑
            if i == 1:
                return None
            continue

        times.append(ms)
        try:
            parsed = json.loads(clean_json(text))
            ok_json += 1
            first_valid = first_valid or parsed
            mark = "✓"
        except Exception:
            mark = "✗ JSON 解析失敗"

        print(f"  {i:2d}. {ms:6.0f} ms  {mark}")

    if not times:
        print(f"\n  全部失敗。最後一個錯誤：{last_err}")
        return None

    s = sorted(times)
    result = {
        "model": model,
        "n": len(times),
        "median": statistics.median(s),
        "p90": s[max(0, int(len(s) * 0.9) - 1)],
        "min": s[0],
        "max": s[-1],
        "json_ok": ok_json,
        "sample": first_valid,
    }

    print(f"\n  中位數 {result['median']:.0f} ms   "
          f"P90 {result['p90']:.0f} ms   "
          f"最快 {result['min']:.0f}   最慢 {result['max']:.0f}")
    print(f"  JSON 可解析率 {ok_json}/{len(times)}")

    if first_valid:
        print(f"\n  範例輸出：")
        print("  " + json.dumps(first_valid, ensure_ascii=False, indent=2)
              .replace("\n", "\n  "))

    return result


def verdict(median: float) -> None:
    print(f"\n{'─' * 62}")
    if median < 1200:
        print("判定：很好。可以做到自動即時更新。")
        print("      Phase 2 照原計畫，節流設 1.5 秒。")
    elif median < 2000:
        print("判定：可用，但偏慢。")
        print("      把節流拉到 2 秒，並確認 rulePlanner 先出框。")
        print("      建議再測 Phi-4-multimodal 看能不能更快。")
    else:
        print("判定：太慢，需要調整策略。三張牌：")
        print("      1. 換小模型（Microsoft-Phi-4-multimodal-instruct）")
        print("      2. --edge 384 把圖再壓小")
        print("      3. 改成「使用者停頓 0.5 秒才觸發」而非固定週期")
        print("\n      注意：這不是災難。rulePlanner 是零延遲的，")
        print("      最壞情況只是 AI 修正變成偶爾發生。")
    print("─" * 62)


# ----------------------------------------------------------------- 進入點
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=10, help="測試次數")
    ap.add_argument("-m", "--model", help="指定模型，預設讀 NCHC_MODEL")
    ap.add_argument("--edge", type=int,
                    default=int(os.getenv("IMAGE_MAX_EDGE", "512")),
                    help="送出影像的長邊上限")
    ap.add_argument("--image", help="用自己的照片，預設用程式生成的測試圖")
    ap.add_argument("--compare", action="store_true",
                    help="一次比較多個候選模型")
    ap.add_argument("--no-json-mode", action="store_true",
                    help="不使用 response_format")
    args = ap.parse_args()

    base_url = os.getenv("NCHC_BASE_URL", "").strip()
    api_key = os.getenv("NCHC_API_KEY", "").strip()

    if not base_url or not api_key:
        print("✗ .env 裡的 NCHC_BASE_URL 或 NCHC_API_KEY 是空的。")
        print("  先填好再跑。這是 Phase 0 的第一個關卡。")
        return 1

    # 準備影像
    if args.image:
        img = Image.open(args.image).convert("RGB")
        print(f"使用照片: {args.image}")
    else:
        img = make_test_image()
        out = ROOT / "scripts" / "_bench_sample.jpg"
        img.save(out, quality=90)
        print(f"使用生成的測試圖（已存到 {out.name} 可自行檢視）")

    img_b64, nbytes = to_b64(img, args.edge)

    client = OpenAI(base_url=base_url, api_key=api_key, timeout=30.0)

    models = ([args.model] if args.model else
              ([os.getenv("NCHC_MODEL", "gemma-4-26B-A4B-it"),
                "Microsoft-Phi-4-multimodal-instruct",
                "gemma-4-31B-it"] if args.compare else
               [os.getenv("NCHC_MODEL", "gemma-4-26B-A4B-it")]))

    use_json_mode = not args.no_json_mode
    results = []

    for m in models:
        r = bench(client, m, img_b64, nbytes / 1024, args.n, use_json_mode)

        # json_mode 不支援的話自動退回再試一次
        if r is None and use_json_mode and len(models) == 1:
            print("\n  → 改用不帶 response_format 再試一次")
            r = bench(client, m, img_b64, nbytes / 1024, args.n, False)
            if r:
                print("\n  ⚠ 這個端點不支援 response_format。")
                print("     server/services/vlm/nchc.py 要靠 prompt 約束，")
                print("     並且一定要做 JSON 清洗。")
        if r:
            results.append(r)

    if not results:
        print("\n✗ 全部失敗。檢查清單：")
        print("  - BASE_URL 結尾要不要加 /v1？")
        print("  - 這台機器需要在校內網路或 VPN 內嗎？")
        print("  - 模型名稱拼對了嗎？")
        print("  - 這個模型支援影像輸入嗎？（純文字模型會直接報錯）")
        return 1

    if len(results) > 1:
        print(f"\n{'=' * 62}\n比較結果\n{'=' * 62}")
        print(f"{'模型':<45}{'中位數':>9}{'P90':>9}")
        for r in sorted(results, key=lambda x: x["median"]):
            print(f"{r['model'][:44]:<45}{r['median']:>8.0f}ms{r['p90']:>8.0f}ms")

    verdict(min(r["median"] for r in results))

    print("\n把數字填進 docs/02-ROADMAP.md 的 Phase 0 實際紀錄。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
