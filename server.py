# -*- coding: utf-8 -*-
"""
上海市餐饮空间分布与 HBase 存储可视化平台 —— 本地 Web 服务

特点：
  1. 零第三方依赖（纯 Python 标准库 ThreadingHTTPServer）
  2. 启动时一次性将 HBase 导出的 78,018 条记录加载并 Gzip 压缩缓存在内存中
  3. 自动探测本地 HBase（127.0.0.1:2181）是否在运行，支持实时单行 Cell 验证

用法：
  python web/server.py               # 默认 http://127.0.0.1:8080 并自动打开浏览器
  python web/server.py --port 8090 --no-browser
"""
from __future__ import annotations

import argparse
import gzip
import json
import mimetypes
import socket
import subprocess
import sys
import time
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent
BASE_DIR = WEB_DIR.parent
sys.path.insert(0, str(WEB_DIR))

import build_web_data  # noqa: E402

DATA_RAW_BYTES: bytes = b""
DATA_GZIP_BYTES: bytes = b""
DATA_META: dict = {}


def load_cached_data() -> None:
    global DATA_RAW_BYTES, DATA_GZIP_BYTES, DATA_META
    t0 = time.time()
    static_json = WEB_DIR / "data" / "restaurants_compact.json"
    if static_json.exists():
        raw_text = static_json.read_text(encoding="utf-8")
        DATA_RAW_BYTES = raw_text.encode("utf-8")
        payload_meta = json.loads(raw_text).get("meta", {})
        DATA_META = payload_meta
    else:
        payload = build_web_data.build_payload()
        DATA_META = payload["meta"]
        DATA_RAW_BYTES = json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")

    DATA_GZIP_BYTES = gzip.compress(DATA_RAW_BYTES, compresslevel=6)
    dt = time.time() - t0
    print(
        f"  [数据就绪] {DATA_META.get('total', 0):,} 条记录 | "
        f"来源: {DATA_META.get('source', '-')} | "
        f"JSON {len(DATA_RAW_BYTES)/1024/1024:.2f} MB "
        f"(Gzip {len(DATA_GZIP_BYTES)/1024/1024:.2f} MB) | 耗时 {dt:.2f}s"
    )


def check_port(host: str, port: int, timeout: float = 0.25) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def query_live_hbase_row(rowkey: str) -> dict:
    """当本机 HBase 启动时，通过 app.bat storage 实时获取 Cell 四元组。"""
    if not rowkey or not rowkey.isalnum() or len(rowkey) > 32:
        return {"ok": False, "error": "无效 RowKey"}
    if not check_port("127.0.0.1", 2181, timeout=0.3):
        return {"ok": False, "hbaseRunning": False, "error": "本地 HBase 未运行（2181 端口未监听）"}

    app_bat = BASE_DIR / "java" / "app.bat"
    if not app_bat.exists():
        return {"ok": False, "error": "找不到 java/app.bat"}

    try:
        proc = subprocess.run(
            ["cmd", "/c", str(app_bat), "storage", "127.0.0.1", rowkey, "2181"],
            cwd=str(BASE_DIR / "java"),
            capture_output=True,
            timeout=15,
        )
        stdout = proc.stdout.decode("gbk", errors="replace")
        if proc.returncode != 0:
            err = proc.stderr.decode("gbk", errors="replace")
            return {"ok": False, "hbaseRunning": True, "error": err or stdout}
        return {"ok": True, "hbaseRunning": True, "rawOutput": stdout}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


class AppHandler(BaseHTTPRequestHandler):
    server_version = "ShanghaiRestaurantHBaseWeb/1.0"

    def log_message(self, fmt: str, *args) -> None:
        # 仅保留关键 API 或错误日志，避免刷屏
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    def _send_json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/data.json":
            accept_enc = self.headers.get("Accept-Encoding", "")
            if "gzip" in accept_enc:
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(DATA_GZIP_BYTES)))
                self.send_header("Cache-Control", "max-age=300")
                self.end_headers()
                self.wfile.write(DATA_GZIP_BYTES)
            else:
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(DATA_RAW_BYTES)))
                self.send_header("Cache-Control", "max-age=300")
                self.end_headers()
                self.wfile.write(DATA_RAW_BYTES)
            return

        if path == "/api/status":
            zk_up = check_port("127.0.0.1", 2181, timeout=0.2)
            ui_up = check_port("127.0.0.1", 16010, timeout=0.2)
            self._send_json({
                "ok": True,
                "meta": DATA_META,
                "hbase": {"zk2181": zk_up, "master16010": ui_up},
            })
            return

        if path == "/api/hbase/live-row":
            qs = urllib.parse.parse_qs(parsed.query)
            rk = (qs.get("rowkey") or [""])[0].strip()
            self._send_json(query_live_hbase_row(rk))
            return

        # 静态资源映射
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (WEB_DIR / rel).resolve()
        if not str(target).startswith(str(WEB_DIR.resolve())) or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        ctype, _ = mimetypes.guess_type(str(target))
        if ctype is None:
            ctype = "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype = f"{ctype}; charset=utf-8"

        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> int:
    parser = argparse.ArgumentParser(description="上海餐饮 HBase 空间可视化服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    print("=" * 68)
    print("  基于 HBase 的上海市餐饮空间分布与存储可视化网站")
    print("=" * 68)
    load_cached_data()

    httpd = None
    bound_port = args.port
    for candidate in range(args.port, args.port + 10):
        try:
            httpd = ThreadingHTTPServer((args.host, candidate), AppHandler)
            bound_port = candidate
            break
        except OSError:
            continue
    if httpd is None:
        raise RuntimeError(f"端口 {args.port}..{args.port + 9} 均被占用，请使用 --port 指定其他端口")

    url = f"http://{args.host}:{bound_port}/"
    print(f"  [服务启动] {url}")
    print("  [提示] 按 Ctrl+C 可停止服务")
    print("=" * 68)

    if not args.no_browser:
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  [已停止]")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
