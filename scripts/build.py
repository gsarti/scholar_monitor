#!/usr/bin/env python3
"""Assemble the static site into dist/.

Reads config.json, substitutes {{BASE_PATH}} and {{CONFIG_JSON}} tokens in
site/index.html, and copies site/ + data/ into dist/.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = ROOT / "site"
DATA_DIR = ROOT / "data"
DIST_DIR = ROOT / "dist"
CONFIG_PATH = ROOT / "config.json"


def main() -> int:
    config = json.loads(CONFIG_PATH.read_text())
    # BASE_PATH env var overrides the config for local preview. Pass BASE_PATH=""
    # to serve the built dist/ at the root (python -m http.server).
    env_base = os.environ.get("BASE_PATH")
    base_path = (env_base if env_base is not None else config.get("base_path", "")).rstrip("/")
    if env_base is not None:
        config = {**config, "base_path": base_path}

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    shutil.copytree(SITE_DIR, DIST_DIR)
    if DATA_DIR.exists():
        shutil.copytree(DATA_DIR, DIST_DIR / "data")

    index_path = DIST_DIR / "index.html"
    html = index_path.read_text()
    html = html.replace("{{BASE_PATH}}", base_path)
    html = html.replace("{{CONFIG_JSON}}", json.dumps(config))
    index_path.write_text(html)

    print(f"built dist/ with base_path={base_path!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
