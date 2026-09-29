# raccoon_change start - verify native v2 credential reads and legacy logout safety
import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "src/raccoon/knowledge-skill/scripts/knowledge_mcp_client.py"
spec = importlib.util.spec_from_file_location("knowledge_mcp_client", SCRIPT)
assert spec and spec.loader
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class KnowledgeAuthTest(unittest.TestCase):
    def test_reads_active_v2_raccoon_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "opencode.db"
            connection = sqlite3.connect(database)
            connection.execute("CREATE TABLE credential (id TEXT, integration_id TEXT, value TEXT, active INTEGER, time_created INTEGER)")
            connection.executemany(
                "INSERT INTO credential VALUES (?, ?, ?, ?, ?)",
                [
                    ("old", "raccoon", json.dumps({"type": "oauth", "access": "old", "expires": 9999999999999}), 0, 1),
                    ("active", "raccoon", json.dumps({"type": "oauth", "access": "new", "refresh": "rotate", "expires": 9999999999999, "metadata": {"baseURL": "https://raccoon.test", "orgCode": "team"}}), 1, 2),
                ],
            )
            connection.commit()
            connection.close()
            with patch.dict(os.environ, {"OPENCODE_DB": str(database)}, clear=True):
                self.assertEqual(client.resolve_config(), ("https://raccoon.test", "new", "team", None, False))

    def test_does_not_reuse_legacy_auth_after_v2_logout(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "opencode.db"
            connection = sqlite3.connect(database)
            connection.execute("CREATE TABLE credential (id TEXT, integration_id TEXT, value TEXT, active INTEGER, time_created INTEGER)")
            connection.commit()
            connection.close()
            data = Path(directory) / "raccoon"
            data.mkdir()
            (data / "auth.json").write_text(json.dumps({"raccoon": {"access": "old"}}))
            with patch.dict(os.environ, {"OPENCODE_DB": str(database), "XDG_DATA_HOME": directory}, clear=True):
                self.assertIsNone(client.load_opencode_raccoon_auth())

    def test_expired_v2_token_does_not_rotate_refresh_token_outside_the_app(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "opencode.db"
            connection = sqlite3.connect(database)
            connection.execute("CREATE TABLE credential (id TEXT, integration_id TEXT, value TEXT, active INTEGER, time_created INTEGER)")
            connection.execute("INSERT INTO credential VALUES (?, ?, ?, ?, ?)", (
                "active", "raccoon", json.dumps({"type": "oauth", "access": "expired", "refresh": "rotate", "expires": 1, "metadata": {"baseURL": "https://raccoon.test"}}), 1, 1,
            ))
            connection.commit()
            connection.close()
            with patch.dict(os.environ, {"OPENCODE_DB": str(database)}, clear=True):
                with self.assertRaisesRegex(SystemExit, "refresh.*Raccoon"):
                    client.resolve_config()


if __name__ == "__main__":
    unittest.main()
# raccoon_change end
