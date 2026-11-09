#!/usr/bin/env python3
"""Octop 私有市场协议的最小实现（开发/验证用）。

GET /api/market/experts  → {success:true,data:{items:[...]}}
GET /packages/<file>.zip → 专家包下载

目录条目字段对齐 hxai-octop/docs/private-market.md：详情(content/quick_prompts等)
必须内嵌在列表项里，Octop 不会二次请求。
用法: python3 market_stub.py <packages_dir> [port]
"""
import json
import sys
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PACKAGES_DIR = Path(sys.argv[1])
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8931
BASE = f"http://127.0.0.1:{PORT}"


def catalog_items():
    items = []
    for z in sorted(PACKAGES_DIR.glob("*.zip")):
        with zipfile.ZipFile(z) as zf:
            manifest = None
            for name in zf.namelist():
                if name == "manifest.json" or name.count("/") == 1 and name.endswith("/manifest.json"):
                    manifest = json.loads(zf.read(name))
                    break
        if not manifest:
            continue
        skill_slugs = sorted(
            name.split("/")[1]
            for name in zf.namelist()
            if name.startswith("skills/") and name.endswith("/SKILL.md") and name.count("/") == 2
        )
        items.append(
            {
                "id": manifest["id"],
                "slug": manifest["id"],
                "label": manifest.get("label"),
                "name": manifest.get("label"),
                "description": manifest.get("description"),
                "icon_name": manifest.get("icon_name"),
                "icon_url": manifest.get("icon_url"),
                "color": manifest.get("color"),
                "version": "1.0.0",
                "skill_slugs": skill_slugs,
                "skill_count": len(skill_slugs),
                "download_url": f"{BASE}/packages/{z.name}",
                "content": manifest.get("welcome_message"),
                "quick_prompts": manifest.get("quick_prompts") or [],
                "task_examples": manifest.get("task_examples") or {},
            }
        )
    return items


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/api/market/experts":
            body = json.dumps(
                {"success": True, "data": {"items": catalog_items()}}, ensure_ascii=False
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/packages/"):
            target = PACKAGES_DIR / self.path.removeprefix("/packages/")
            if target.is_file() and target.suffix == ".zip":
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.end_headers()
                self.wfile.write(target.read_bytes())
                return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *a):
        print("[market]", *a[:2])


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
