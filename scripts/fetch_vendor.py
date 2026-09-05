#!/usr/bin/env python3
"""下載第三方 JS 函式庫到本機。

為什麼要做這件事：
    600 人的會場 Wi-Fi 一定會塞。如果 TF.js 從 CDN 載不下來，
    整個產品連物件偵測都做不了。

    index.html 已經寫成「本機優先、CDN 備援」，
    所以跑過這支之後，斷網也能跑。

用法:
    python scripts/fetch_vendor.py
"""

from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "web" / "js" / "vendor"

FILES = {
    "tf.min.js":
        "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js",
    "coco-ssd.min.js":
        "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/"
        "dist/coco-ssd.min.js",
}


def main() -> int:
    VENDOR.mkdir(parents=True, exist_ok=True)
    ok = True

    for name, url in FILES.items():
        dest = VENDOR / name
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"  已存在  {name} ({dest.stat().st_size // 1024} KB)")
            continue
        try:
            print(f"  下載中  {name} …", end="", flush=True)
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            dest.write_bytes(data)
            print(f" 完成 ({len(data) // 1024} KB)")
        except Exception as e:
            print(f" 失敗：{e}")
            ok = False

    if ok:
        print("\n✓ 本機副本就緒，斷網也能載入")
    else:
        print("\n⚠ 有檔案下載失敗。會退回 CDN，但會場網路塞住時會有風險。")

    print("\n注意：COCO-SSD 的模型權重仍然是執行時才從網路抓的。")
    print("目前這一版沒有用到物件偵測（改由 VLM 直接看圖），")
    print("所以這兩個檔案暫時不是必要的，之後做對齊判斷時才會用上。")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
