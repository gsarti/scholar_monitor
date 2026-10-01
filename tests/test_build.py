import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from scripts import build


class AssetVersionTests(unittest.TestCase):
    def test_dependency_changes_refresh_entry_and_relative_import_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / "site"
            assets = site / "assets"
            assets.mkdir(parents=True)
            (site / "index.html").write_text('<script src="{{ASSET_PATH}}/app.js"></script>')
            (assets / "app.js").write_text('import "./chart.js";')
            (assets / "chart.js").write_text("export const scale = 'shared';")
            config = root / "config.json"
            config.write_text(json.dumps({"base_path": "/scholar_monitor"}))
            dist = root / "dist"

            with patch.multiple(build, SITE_DIR=site, DATA_DIR=root / "data", DIST_DIR=dist, CONFIG_PATH=config), patch.dict(os.environ, {}, clear=True):
                def built_url():
                    build.main()
                    return re.search(r'src="([^"]+)"', (dist / "index.html").read_text()).group(1)

                original = built_url()
                self.assertEqual(built_url(), original)
                (assets / "chart.js").write_text("export const scale = 'per-paper';")
                updated = built_url()
                self.assertNotEqual(updated, original)
                self.assertTrue(updated.startswith("/scholar_monitor/assets/"))
                entry = dist / updated.removeprefix("/scholar_monitor/")
                self.assertEqual(entry.read_text(), 'import "./chart.js";')
                self.assertIn("per-paper", (entry.parent / "chart.js").read_text())

                with patch.dict(os.environ, {"BASE_PATH": ""}):
                    local = built_url()
                    self.assertEqual(local, updated.removeprefix("/scholar_monitor"))
                    self.assertTrue((dist / local.lstrip("/")).is_file())


if __name__ == "__main__":
    unittest.main()
