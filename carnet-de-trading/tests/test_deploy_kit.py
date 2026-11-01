"""Kit de déploiement : cohérence des fichiers systemd, proxy TLS et scripts.

Ces tests ne lancent ni systemd ni nginx : ils vérifient que les fichiers livrés
sont complets, sûrs et cohérents avec le code (ports, chemins, durcissement).
"""

from __future__ import annotations

import configparser
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"


class DeployFilesTests(unittest.TestCase):
    def test_expected_files_exist_and_are_not_empty(self):
        expected = [
            "install.sh",
            "uninstall.sh",
            "carnet.env.example",
            "systemd/carnet.service",
            "systemd/carnet-drill.service",
            "systemd/carnet-drill.timer",
            "nginx/carnet.conf",
            "caddy/Caddyfile",
            "windows/install-agent.ps1",
        ]
        for relative in expected:
            path = DEPLOY / relative
            self.assertTrue(path.is_file(), f"{relative} manquant")
            self.assertGreater(path.stat().st_size, 100, f"{relative} suspicieusement court")

    def test_shell_scripts_start_with_shebang_and_are_strict(self):
        for name in ("install.sh", "uninstall.sh"):
            text = (DEPLOY / name).read_text(encoding="utf-8")
            self.assertTrue(text.startswith("#!/usr/bin/env bash"), name)
            self.assertIn("set -euo pipefail", text, name)

    def test_shell_syntax_is_valid(self):
        if not shutil.which("bash"):
            self.skipTest("bash indisponible")
        for name in ("install.sh", "uninstall.sh"):
            result = subprocess.run(["bash", "-n", str(DEPLOY / name)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, f"{name}: {result.stderr}")

    def test_install_script_references_the_service_unit(self):
        text = (DEPLOY / "install.sh").read_text(encoding="utf-8")
        self.assertIn("carnet.service", text)
        self.assertIn("daemon-reload", text)
        self.assertIn("/api/health", text)
        self.assertIn("127.0.0.1", text)
        self.assertNotIn("curl | sh", text)
        self.assertNotIn("curl -sSL", text)


class SystemdUnitTests(unittest.TestCase):
    def setUp(self):
        parser = configparser.ConfigParser(interpolation=None, strict=False)
        parser.optionxform = str
        parser.read(DEPLOY / "systemd" / "carnet.service", encoding="utf-8")
        self.unit = parser

    def test_listens_on_loopback_and_binds_service_user(self):
        service = self.unit["Service"]
        self.assertEqual(service["User"], "carnet")
        self.assertIn("--host 127.0.0.1", service["ExecStart"])
        self.assertIn("-m carnet.server", service["ExecStart"])
        self.assertEqual(service["EnvironmentFile"], "/etc/carnet/carnet.env")

    def test_hardening_directives(self):
        service = self.unit["Service"]
        for key in ("NoNewPrivileges", "PrivateTmp", "ProtectSystem", "ProtectHome",
                    "RestrictAddressFamilies", "MemoryDenyWriteExecute", "UMask"):
            self.assertIn(key, service, f"directive {key} absente")
        self.assertEqual(service["ProtectSystem"], "strict")
        self.assertEqual(service["NoNewPrivileges"], "yes")
        self.assertIn("/var/lib/carnet", service["ReadWritePaths"])

    def test_restart_policy_and_install_section(self):
        self.assertEqual(self.unit["Service"]["Restart"], "on-failure")
        self.assertIn("multi-user.target", self.unit["Install"]["WantedBy"])

    def test_backup_drill_timer(self):
        parser = configparser.ConfigParser(interpolation=None, strict=False)
        parser.read(DEPLOY / "systemd" / "carnet-drill.timer", encoding="utf-8")
        self.assertIn("OnCalendar", parser["Timer"])
        self.assertEqual(parser["Timer"]["Unit"], "carnet-drill.service")


class EnvironmentExampleTests(unittest.TestCase):
    def setUp(self):
        self.text = (DEPLOY / "carnet.env.example").read_text(encoding="utf-8")
        self.values = {}
        for line in self.text.splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                self.values[key] = value

    def test_no_real_trading_and_no_secrets(self):
        self.assertEqual(self.values["CARNET_ALLOW_REAL"], "0")
        self.assertEqual(self.values["CARNET_HOST"], "127.0.0.1")
        self.assertEqual(self.values["CARNET_PORT"], "8080")
        self.assertEqual(self.values["CARNET_ADMIN_PASSWORD"], "")
        self.assertEqual(self.values["CARNET_WEBHOOK_URL"], "")

    def test_paths_point_to_state_directory(self):
        for key in ("CARNET_DATA_DIR", "CARNET_VAR_DIR", "CARNET_BACKUP_DIR"):
            self.assertTrue(self.values[key].startswith("/var/lib/carnet/"), key)

    def test_environment_documented(self):
        self.assertIn("CARNET_ENV=SIMULATION", self.text)
        self.assertIn("CARNET_WEBHOOK_URL", self.text)


class NginxConfigTests(unittest.TestCase):
    def setUp(self):
        self.text = (DEPLOY / "nginx" / "carnet.conf").read_text(encoding="utf-8")

    def test_tls_and_modern_protocols(self):
        self.assertIn("listen 443 ssl", self.text)
        self.assertIn("ssl_certificate ", self.text)
        self.assertIn("TLSv1.2 TLSv1.3", self.text)
        self.assertNotIn("TLSv1.1", self.text)
        self.assertNotIn("SSLv3", self.text)

    def test_redirects_and_proxies_to_loopback(self):
        self.assertIn("return 301 https://", self.text)
        self.assertIn("proxy_pass http://127.0.0.1:8080", self.text)
        self.assertNotIn("proxy_pass http://0.0.0.0", self.text)

    def test_security_headers_and_login_rate_limit(self):
        for header in ("Strict-Transport-Security", "X-Content-Type-Options",
                       "X-Frame-Options", "Referrer-Policy"):
            self.assertIn(header, self.text)
        self.assertIn("limit_req_zone", self.text)
        self.assertIn("location = /api/auth/login", self.text)
        self.assertIn("client_max_body_size", self.text)


class CaddyConfigTests(unittest.TestCase):
    def test_reverse_proxy_and_headers(self):
        text = (DEPLOY / "caddy" / "Caddyfile").read_text(encoding="utf-8")
        self.assertIn("reverse_proxy 127.0.0.1:8080", text)
        self.assertIn("Strict-Transport-Security", text)
        self.assertIn("health_uri /api/health", text)


class WindowsAgentInstallerTests(unittest.TestCase):
    def setUp(self):
        self.text = (DEPLOY / "windows" / "install-agent.ps1").read_text(encoding="utf-8")

    def test_installs_agent_with_restricted_token_and_scheduled_task(self):
        self.assertIn("mt5_agent.py", self.text)
        self.assertIn("Register-ScheduledTask", self.text)
        self.assertIn("--host 127.0.0.1", self.text)
        self.assertIn("icacls", self.text)
        self.assertIn("Administrators:F", self.text)

    def test_documents_tunnel_and_demo_only(self):
        self.assertIn("ssh -N -L", self.text)
        self.assertIn("comptes démo", self.text)


class DeploymentDocTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / "docs" / "DEPLOYMENT.md").read_text(encoding="utf-8")

    def test_covers_all_operational_topics(self):
        for topic in ("systemd", "nginx", "Caddy", "TLS", "MT5", "webhook",
                      "sauvegarde", "ufw", "/api/health", "demo"):
            self.assertIn(topic.lower(), self.text.lower(), topic)

    def test_states_the_guardrails(self):
        self.assertIn("aucun ordre réel", self.text.lower())
        self.assertIn("CARNET_ALLOW_REAL=0", self.text)
        self.assertIn("127.0.0.1:8080", self.text)
        self.assertIn("REAL_TRADING_FORBIDDEN", self.text)


if __name__ == "__main__":
    unittest.main()
