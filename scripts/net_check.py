#!/usr/bin/env python3
"""連線診斷。

手機連不到電腦上的服務時跑這支，它會一次檢查完所有常見原因。

用法:
    python scripts/net_check.py
    python scripts/net_check.py --port 8000
"""

from __future__ import annotations

import argparse
import platform
import socket
import subprocess
import sys

IS_WIN = platform.system() == "Windows"

OK = "  \u2713"
NO = "  \u2717"
WARN = "  !"


def local_ips() -> list[tuple[str, str]]:
    """列出本機的 IPv4 位址，附上用途說明。"""
    out = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None,
                                       socket.AF_INET):
            ip = info[4][0]
            if ip in (x[0] for x in out):
                continue
            out.append((ip, describe(ip)))
    except OSError:
        pass
    return out


def describe(ip: str) -> str:
    if ip.startswith("127."):
        return "本機回送，手機連不到"
    if ip.startswith("169.254."):
        return "自動配置位址（沒拿到 DHCP），不能用"
    if ip.startswith("172.16.0."):
        return "很可能是 Cloudflare WARP 的虛擬網卡，不要用這個"
    if ip.startswith("192.168.56."):
        return "VirtualBox / VMware 虛擬網卡，手機連不到"
    if ip.startswith(("192.168.", "10.", "172.")):
        return "區域網路位址，手機應該用這個"
    return "外部位址"


def can_connect(host: str, port: int, timeout: float = 1.5) -> bool:
    """直接試連。netstat 不可用時的備援。"""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def port_listening(port: int) -> tuple[bool, str]:
    """檢查 port 有沒有在監聽，以及是不是綁在 0.0.0.0。"""
    try:
        cmd = ["netstat", "-ano"] if IS_WIN else ["netstat", "-tuln"]
        text = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=10).stdout
    except Exception:
        # netstat 不可用時，改用直接連線判斷
        loopback = can_connect("127.0.0.1", port)
        if not loopback:
            return False, "127.0.0.1 連不上，服務可能沒啟動"
        for ip, note in local_ips():
            if "手機應該用這個" in note:
                if can_connect(ip, port):
                    return True, f"{ip}:{port} 連得上，綁定正確"
                return False, (f"{ip}:{port} 連不上，"
                               "服務可能只綁在 127.0.0.1")
        return True, "127.0.0.1 連得上，但查不到區域網路位址"

    lines = [l for l in text.splitlines()
             if f":{port}" in l and ("LISTEN" in l.upper())]
    if not lines:
        return False, "沒有任何程式在監聽這個 port"

    joined = " ".join(lines)
    if "0.0.0.0" in joined or "[::]" in joined:
        return True, "綁在 0.0.0.0，手機可以連（前提是防火牆放行）"
    if "127.0.0.1" in joined:
        return False, ("只綁在 127.0.0.1，手機連不到。"
                       "啟動時要加 --host 0.0.0.0")
    return True, lines[0].strip()


def firewall_rule(port: int) -> tuple[bool, str]:
    """Windows：檢查有沒有放行這個 port 的輸入規則。"""
    if not IS_WIN:
        return True, "非 Windows，略過"
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"Get-NetFirewallRule -Direction Inbound -Enabled True "
             f"-Action Allow 2>$null | Get-NetFirewallPortFilter "
             f"| Where-Object {{ $_.LocalPort -eq {port} }} "
             f"| Measure-Object | Select-Object -ExpandProperty Count"],
            capture_output=True, text=True, timeout=25)
        n = int((r.stdout or "0").strip() or 0)
        return n > 0, ("找到放行規則" if n > 0 else "沒有放行規則")
    except Exception as e:
        return False, f"查不到（{e}）"


def firewall_profile() -> str:
    """目前作用中的網路設定檔。手機熱點通常會被判定為公用。"""
    if not IS_WIN:
        return "非 Windows"
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-NetConnectionProfile).NetworkCategory -join ', '"],
            capture_output=True, text=True, timeout=15)
        return (r.stdout or "").strip() or "查不到"
    except Exception:
        return "查不到"


def warp_running() -> bool:
    if not IS_WIN:
        return False
    try:
        r = subprocess.run(["tasklist"], capture_output=True,
                           text=True, timeout=15)
        return "warp-svc" in r.stdout.lower()
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    port = args.port

    print(f"\n{'=' * 60}\n連線診斷（port {port}）\n{'=' * 60}")

    # 1. 服務有沒有在跑
    print("\n【1】服務狀態")
    listening, detail = port_listening(port)
    print(f"{OK if listening else NO} {detail}")
    if not listening:
        print("      先確認 uvicorn 有跑起來，而且加了 --host 0.0.0.0")

    # 2. 本機位址
    print("\n【2】本機 IPv4 位址")
    ips = local_ips()
    usable = []
    for ip, note in ips:
        mark = OK if "手機應該用這個" in note else WARN
        print(f"{mark} {ip:<16} {note}")
        if "手機應該用這個" in note:
            usable.append(ip)
    if not ips:
        print(f"{NO} 查不到任何位址")

    # 3. 防火牆
    print("\n【3】Windows 防火牆")
    profile = firewall_profile()
    print(f"      目前網路設定檔：{profile}")
    has_rule, note = firewall_rule(port)
    print(f"{OK if has_rule else NO} {note}")
    if not has_rule:
        print("      這是手機連不到最常見的原因。")
        print("      用系統管理員身分開 PowerShell，執行：")
        print(f'      New-NetFirewallRule -DisplayName "SnapFit {port}" '
              f"-Direction Inbound -Protocol TCP "
              f"-LocalPort {port} -Action Allow -Profile Any")
    if "Public" in profile:
        print(f"{WARN} 目前是公用網路。公用設定檔預設封鎖所有輸入連線，")
        print("      所以上面那條規則的 -Profile Any 不能省。")

    # 4. VPN 干擾
    print("\n【4】VPN 干擾")
    if warp_running():
        print(f"{WARN} 偵測到 Cloudflare WARP 正在執行。")
        print("      WARP 會接管路由，常見副作用就是區域網路互連被切斷。")
        print("      測試時先在 WARP 的圖示上按「中斷連線」再試一次。")
    else:
        print(f"{OK} 沒有偵測到 WARP")

    # 5. 結論
    print(f"\n{'=' * 60}\n該用哪個網址\n{'=' * 60}")

    if usable:
        for ip in usable:
            print(f"\n  區域網路：http://{ip}:{port}/")
        print("\n  但是要注意：這是 HTTP，不是 HTTPS。")
        print("  瀏覽器規定相機只能在安全來源下使用，")
        print("  也就是 HTTPS 或 localhost。純 IP 的 HTTP 一律不行。")
        print("  所以這個網址只能檢查版面，不能測相機。")

    print(f"\n  要測相機，用 Cloudflare Tunnel：")
    print(f"      cloudflared tunnel --url http://localhost:{port}")
    print("  它會給你一個 https:// 開頭的網址，相機才開得起來。")

    print("\n  Android 還有一個更快的方法（USB 線）：")
    print("      1. 手機開啟「開發人員選項」與「USB 偵錯」")
    print("      2. 電腦 Chrome 開 chrome://inspect")
    print("      3. Port forwarding 加一條 "
          f"{port} → localhost:{port}")
    print(f"      4. 手機瀏覽器開 http://localhost:{port}")
    print("  手機看到的是 localhost，屬於安全來源，相機可以用。")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
