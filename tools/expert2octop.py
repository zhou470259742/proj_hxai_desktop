#!/usr/bin/env python3
"""hxai-admin 专家记录 → Octop 专家包(zip) 转换器。

用法:
    python3 expert2octop.py expert.json -o out_dir/

输入 expert.json 采用 hxai-admin 的 Expert 导出字段（camelCase）:
    key, name, summary, rolePrompt, version, emoji,
    skills: [{key, name, description, content}],
    subAgents: [{key, content}],        # 可选
    welcomeMessage, quickPrompts, taskExamples  # 可选
产出 <out_dir>/<key>-<version>.zip，符合 hxai-octop/docs/expert-package.md。
仅标准库。
"""
import json
import re
import sys
import zipfile
from pathlib import Path

MAX_MEMBERS = 2000
MAX_MEMBER_BYTES = 64 * 1024 * 1024
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")


def localize(value):
    """字符串 → {zh,en} 双写；已是对象则原样返回。"""
    if isinstance(value, dict):
        return value
    return {"zh": value, "en": value}


def build_package(expert: dict, out_zip: Path) -> Path:
    key = expert["key"].strip()
    if not ID_RE.match(key):
        raise SystemExit(f"专家 key 不合法（Octop 要求 {ID_RE.pattern}）: {key}")
    version = expert.get("version") or "1.0.0"

    manifest: dict = {
        "id": key,
        "label": localize(expert["name"]),
        "description": localize(expert.get("summary") or expert["name"]),
        "welcome_message": localize(
            expert.get("welcomeMessage") or f"你好，我是{expert['name']}，请告诉我你的需求。"
        ),
        "icon_name": expert.get("iconName") or "user",
        "prompt_files": ["SOUL.md"],
    }
    if expert.get("color"):
        manifest["color"] = expert["color"]
    if expert.get("iconUrl"):
        manifest["icon_url"] = expert["iconUrl"]
    if expert.get("quickPrompts"):
        manifest["quick_prompts"] = [
            {
                "title": localize(q["title"]),
                "description": localize(q.get("description") or ""),
                "prompt": localize(q["prompt"]),
                **({"icon_name": q["iconName"]} if q.get("iconName") else {}),
                **({"color": q["color"]} if q.get("color") else {}),
            }
            for q in expert["quickPrompts"]
        ]
    if expert.get("taskExamples"):
        manifest["task_examples"] = expert["taskExamples"]

    soul = expert.get("rolePrompt") or f"# {expert['name']}\n"
    files: dict[str, str] = {
        "manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2),
        "SOUL.md": soul,
    }
    for skill in expert.get("skills") or []:
        skey = skill["key"]
        if not ID_RE.match(skey):
            raise SystemExit(f"技能 key 不合法: {skey}")
        fm = f"---\nname: {skey}\ndescription: {skill.get('description') or skill['name']}\n---\n\n"
        files[f"skills/{skey}/SKILL.md"] = fm + (skill.get("content") or "")
    for agent in expert.get("subAgents") or []:
        files[f"agents/{agent['key']}.md"] = agent.get("content") or ""

    if len(files) > MAX_MEMBERS:
        raise SystemExit("成员数超限")
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            data = content.encode("utf-8")
            if len(data) > MAX_MEMBER_BYTES:
                raise SystemExit(f"成员超限: {name}")
            zf.writestr(name, data)
    return out_zip


def main() -> None:
    src = Path(sys.argv[1])
    out_dir = Path(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[2] == "-o" else src.parent
    expert = json.loads(src.read_text("utf-8"))
    version = expert.get("version") or "1.0.0"
    out = build_package(expert, out_dir / f"{expert['key']}-{version}.zip")
    print(out)


if __name__ == "__main__":
    main()
