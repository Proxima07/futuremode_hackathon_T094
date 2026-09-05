#!/usr/bin/env python3
"""啟動 Cloudflare Tunnel，並把網址變成可以直接掃的 QR code。

為什麼需要 HTTPS：
    瀏覽器規定相機只能在「安全來源」下使用。
    安全來源是 HTTPS 或 localhost。
    http://192.168.x.x:8000 這種純 IP 的 HTTP 一律不行。

用法:
    python scripts/tunnel.py                # 預設 port 8000
    python scripts/tunnel.py --port 8000
    python scripts/tunnel.py --no-qr        # 只印網址

注意:
    - uvicorn 要先跑起來，這支只負責把它打到公網
    - 每次重啟網址都會變。Demo 當天要提早開好、把 QR 印出來
    - 如果電腦上有 Cloudflare WARP 在跑，先把它中斷，兩者會打架
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def print_qr(url: str) -> None:
    """在終端機印出 QR code。用半形方塊字元，掃得到。"""
    try:
        import qrcode
    except ImportError:
        print("  （沒有安裝 qrcode 套件，略過 QR。")
        print("    pip install qrcode 之後就會顯示）")
        return

    qr = qrcode.QRCode(border=2, box_size=1,
                       error_correction=qrcode.constants.ERROR_CORRECT_L)
    qr.add_data(url)
    qr.make(fit=True)
    m = qr.get_matrix()

    # 一個字元高度約等於兩個像素，用上下半塊把兩列壓成一列
    print()
    for y in range(0, len(m), 2):
        line = []
        for x in range(len(m[0])):
            top = m[y][x]
            bot = m[y + 1][x] if y + 1 < len(m) else False
            if top and bot:
                line.append("\u2588")      # 全滿
            elif top:
                line.append("\u2580")      # 上半
            elif bot:
                line.append("\u2584")      # 下半
            else:
                line.append(" ")
        print("  " + "".join(line))
    print()

    # 存一份 PNG，Demo 當天要印出來貼在攤位上
    try:
        out = ROOT / "assets" / "tunnel-qr.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        qrcode.make(url).save(out)
        print(f"  QR 圖檔已存到 {out.relative_to(ROOT)}")
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-qr", action="store_true")
    args = ap.parse_args()

    if not shutil.which("cloudflared"):
        print("找不到 cloudflared。安裝方式：")
        print("  winget install --id Cloudflare.cloudflared")
        print("  或到 https://github.com/cloudflare/cloudflared/releases 下載")
        return 1

    target = f"http://localhost:{args.port}"
    print(f"→ 把 {target} 打到公網…\n")

    proc = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", target],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    found = threading.Event()

    def pump():
        # cloudflared 把訊息寫在 stderr，已經合併到 stdout
        for line in proc.stdout:
            if not found.is_set():
                m = URL_RE.search(line)
                if m:
                    url = m.group(0)
                    found.set()
                    print("=" * 58)
                    print("  手機用這個網址（HTTPS，相機才開得起來）")
                    print("=" * 58)
                    print(f"\n  {url}\n")
                    if not args.no_qr:
                        print_qr(url)
                    print("=" * 58)
                    print("  版型預覽： " + url + "/layouts-preview.html")
                    print("  健康檢查： " + url + "/api/health")
                    print("=" * 58)
                    print("\n  Ctrl+C 結束。網址每次重啟都會變。\n")
                    continue
            # 找到網址之後只印錯誤，避免洗版
            low = line.lower()
            if any(k in low for k in ("err", "fail", "warn")):
                print("  " + line.rstrip())

    t = threading.Thread(target=pump, daemon=True)
    t.start()

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\n→ 關閉 tunnel")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
