"""Canaux d'alerte externes (section 19.2) : formatage, réessais, secret, API."""

from __future__ import annotations

import json
import os
import time
import unittest
from unittest import mock

from helpers import ApiTestCase, TempProject

from carnet.alerts import MAX_CONSECUTIVE_FAILURES, AlertNotifier, validate_url


class FakeTransport:
    def __init__(self, statuses=None, status=200):
        self.calls = []
        self.statuses = list(statuses or [])
        self.status = status

    def __call__(self, url, payload, headers, timeout):
        self.calls.append((url, json.loads(payload.decode()), dict(headers)))
        if self.statuses:
            current = self.statuses.pop(0)
            if isinstance(current, Exception):
                raise current
            return current
        return self.status


class AlertNotifierTests(unittest.TestCase):
    def setUp(self):
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.path = self.project.path / "var" / "alerts.json"
        self.transport = FakeTransport()
        self.notifier = AlertNotifier(self.path, transport=self.transport,
                                      backoff=(0.0, 0.0, 0.0))

    def configure(self, url="https://hooks.slack.com/services/T000/B000/secret-token",
                  **kwargs):
        kwargs.setdefault("enabled", True)
        return self.notifier.configure(url=url, **kwargs)

    def record(self, level="CRITICAL"):
        return {"level": level, "code": "KILL_SWITCH", "title": "Arrêt d'urgence",
                "message": "Entrées bloquées.", "created_at": "2026-11-01T15:00:00.000Z"}

    # -- configuration ---------------------------------------------------
    def test_configuration_is_persisted_with_restricted_permissions(self):
        status = self.configure()
        self.assertTrue(status["enabled"])
        self.assertEqual(status["resolved_format"], "slack")
        self.assertTrue(self.path.exists())
        self.assertEqual(oct(os.stat(self.path).st_mode)[-3:], "600")
        reloaded = AlertNotifier(self.path)
        self.assertTrue(reloaded.config.enabled)
        self.assertEqual(reloaded.config.format, "auto")

    def test_url_validation(self):
        with self.assertRaises(ValueError):
            self.notifier.configure(url="hooks.slack.com/services/x", enabled=True)
        with self.assertRaises(ValueError):
            self.notifier.configure(url="", enabled=True)
        with self.assertRaises(ValueError):
            self.notifier.configure(url="https://example.com/hook", format="inconnu")
        with self.assertRaises(ValueError):
            self.notifier.configure(url="https://example.com/hook", min_level="TRACE")

    def test_secret_is_masked(self):
        status = self.configure()
        self.assertNotIn("secret-token", json.dumps(status))
        self.assertIn("hooks.slack.com", status["url_masked"])

    def test_disable(self):
        self.configure()
        status = self.notifier.disable()
        self.assertFalse(status["enabled"])
        self.assertFalse(AlertNotifier(self.path).config.enabled)

    # -- formats ---------------------------------------------------------
    def test_slack_payload(self):
        self.configure()
        payload = self.notifier.build_payload(self.record())
        self.assertIn("attachments", payload)
        self.assertIn("Arrêt d'urgence", payload["text"])
        self.assertEqual(payload["attachments"][0]["color"], "#FF707D")

    def test_discord_payload(self):
        self.configure(url="https://discord.com/api/webhooks/123/abc")
        payload = self.notifier.build_payload(self.record("WARNING"))
        self.assertIn("embeds", payload)
        self.assertEqual(payload["embeds"][0]["color"], int("F5A524", 16))
        self.assertEqual(payload["embeds"][0]["title"], "Arrêt d'urgence")

    def test_teams_payload(self):
        self.configure(url="https://example.webhook.office.com/webhookb2/xyz")
        payload = self.notifier.build_payload(self.record())
        self.assertEqual(payload["@type"], "MessageCard")
        self.assertEqual(payload["summary"], "Arrêt d'urgence")

    def test_generic_payload(self):
        self.configure(url="https://example.com/hook")
        payload = self.notifier.build_payload(self.record("INFO"))
        self.assertEqual(payload["code"], "KILL_SWITCH")
        self.assertEqual(payload["level"], "INFO")
        self.assertNotIn("attachments", payload)

    def test_explicit_format_overrides_detection(self):
        self.configure(url="https://example.com/hook", format="slack")
        payload = self.notifier.build_payload(self.record())
        self.assertIn("attachments", payload)

    # -- envoi -----------------------------------------------------------
    def test_send_success_records_result(self):
        self.configure()
        result = self.notifier.send(self.record())
        self.assertTrue(result.ok)
        self.assertEqual(result.attempts, 1)
        self.assertEqual(len(self.transport.calls), 1)
        self.assertEqual(self.notifier.sent, 1)
        self.assertTrue(self.notifier.status()["last_result"]["ok"])
        self.assertEqual(self.transport.calls[0][2]["Content-Type"], "application/json")

    def test_retry_then_success(self):
        self.transport.statuses = [500, 503, 200]
        self.configure()
        result = self.notifier.send(self.record())
        self.assertTrue(result.ok)
        self.assertEqual(result.attempts, 3)
        self.assertEqual(len(self.transport.calls), 3)

    def test_gives_up_after_retries(self):
        self.transport.statuses = [500, 500, 500]
        self.configure()
        result = self.notifier.send(self.record())
        self.assertFalse(result.ok)
        self.assertEqual(result.attempts, 3)
        self.assertEqual(self.notifier.failures, 1)
        self.assertIn("HTTP 500", result.error)

    def test_network_error_is_reported(self):
        self.transport.statuses = [ConnectionError("DNS introuvable")] * 3
        self.configure()
        result = self.notifier.send(self.record())
        self.assertFalse(result.ok)
        self.assertIn("ConnectionError", result.error)

    def test_hook_respects_enabled_and_min_level(self):
        self.configure(min_level="CRITICAL")
        self.notifier.hook(self.record("INFO"))
        self.notifier.hook(self.record("WARNING"))
        # envoi asynchrone : les niveaux insuffisants ne doivent rien déclencher
        self.assertEqual(len(self.transport.calls), 0)

    def test_hook_sends_for_matching_level(self):
        import time

        self.configure(min_level="CRITICAL")
        self.notifier.hook(self.record("CRITICAL"))
        for _ in range(50):
            if self.transport.calls:
                break
            time.sleep(0.02)
        self.assertEqual(len(self.transport.calls), 1)

    def test_test_endpoint_payload(self):
        self.configure(url="https://exemple.test/hook")
        result = self.notifier.test()
        self.assertTrue(result["ok"])
        self.assertEqual(self.transport.calls[0][1]["code"], "ALERT_TEST")

    def test_unconfigured_send_is_refused(self):
        result = self.notifier.send(self.record())
        self.assertFalse(result.ok)
        self.assertIn("non configuré", result.error)
        self.assertEqual(self.transport.calls, [])


class AlertUrlSafetyTests(unittest.TestCase):
    """Régression : l'URL masquée (« … ») ne doit jamais être enregistrée.

    Observé en production : le formulaire réaffichait l'URL masquée, « Enregistrer »
    la renvoyait, le serveur l'acceptait, puis chaque envoi échouait en ASCII et
    gonflait la base de milliers d'échecs.
    """

    MASKED = "https://discord.com/api/webhooks/1566815286643138…/…"
    REAL = "https://discord.com/api/webhooks/1566815286643138560/IpCs0yME0uBhBlMx"

    def setUp(self):
        self.project = TempProject()
        self.addCleanup(self.project.cleanup)
        self.path = self.project.path / "var" / "alerts.json"
        self.transport = FakeTransport()
        self.journal = _RecordingJournal()
        self.notifier = AlertNotifier(self.path, journal=self.journal,
                                      transport=self.transport, retries=1,
                                      backoff=(0.0, 0.0, 0.0))

    def test_validate_url_accepts_complete_webhook(self):
        self.assertEqual(validate_url(f"  {self.REAL}  "), self.REAL)
        self.assertEqual(validate_url(""), "")

    def test_validate_url_refuses_masked_or_non_ascii(self):
        for bad in (self.MASKED, "https://exemple.fr/hook…", "***",
                    "https://exemple.fr/ho ok", "https://exemple.fr/é"):
            with self.assertRaises(ValueError, msg=bad):
                validate_url(bad)

    def test_validate_url_refuses_truncated_hosts(self):
        for bad in ("discord.com/api/webhooks/1/x", "https://", "https:///hook"):
            with self.assertRaises(ValueError, msg=bad):
                validate_url(bad)

    def test_configure_refuses_masked_url_and_keeps_previous_value(self):
        self.notifier.configure(url=self.REAL, enabled=True)
        with self.assertRaises(ValueError) as caught:
            self.notifier.configure(url=self.MASKED)
        self.assertIn("tronquée", str(caught.exception))
        self.assertEqual(self.notifier.config.url, self.REAL)
        self.assertTrue(self.notifier.config.enabled)

    def test_configure_without_url_keeps_existing_target(self):
        self.notifier.configure(url=self.REAL, enabled=True)
        status = self.notifier.configure(min_level="INFO")
        self.assertEqual(self.notifier.config.url, self.REAL)
        self.assertEqual(status["min_level"], "INFO")
        self.assertTrue(status["enabled"])

    def test_send_with_non_ascii_url_fails_cleanly(self):
        self.notifier.configure(url=self.REAL, enabled=True)
        self.notifier.config.url = self.MASKED  # simule un fichier corrompu
        result = self.notifier.send({"level": "CRITICAL", "code": "TEST",
                                     "title": "t", "message": "m"})
        self.assertFalse(result.ok)
        self.assertIn("URL invalide", result.error)
        self.assertEqual(self.transport.calls, [])

    def test_channel_disables_itself_after_repeated_failures(self):
        self.notifier.configure(url=self.REAL, enabled=True)
        self.transport.status = 500
        for _ in range(MAX_CONSECUTIVE_FAILURES):
            self.notifier.send({"level": "CRITICAL", "code": "TEST", "title": "t",
                                "message": "m"})
        self.assertFalse(self.notifier.config.enabled)
        self.assertTrue(self.notifier.status()["auto_disabled"])
        calls = len(self.transport.calls)
        self.notifier.hook({"level": "CRITICAL", "code": "TEST", "title": "t", "message": "m"})
        time.sleep(0.05)
        self.assertEqual(len(self.transport.calls), calls,
                         "plus aucun envoi automatique après disjonction")
        self.assertIn("ALERT_CHANNEL_DISABLED", [code for _, code, _ in self.journal.warnings])

    def test_success_resets_the_failure_counter(self):
        self.notifier.configure(url=self.REAL, enabled=True)
        self.transport.statuses = [500, 200]
        self.notifier.send({"level": "CRITICAL", "code": "T", "title": "t", "message": "m"})
        self.assertNotifierCounter(1)
        self.notifier.send({"level": "CRITICAL", "code": "T", "title": "t", "message": "m"})
        self.assertNotifierCounter(0)
        self.assertTrue(self.notifier.config.enabled)

    def assertNotifierCounter(self, expected):
        self.assertEqual(self.notifier.consecutive_failures, expected)

    def test_environment_variable_configures_the_channel(self):
        with mock.patch.dict(os.environ, {"CARNET_WEBHOOK_URL": self.REAL,
                                          "CARNET_WEBHOOK_MIN_LEVEL": "INFO"}, clear=False):
            notifier = AlertNotifier(self.path, transport=self.transport)
        self.assertEqual(notifier.config.url, self.REAL)
        self.assertTrue(notifier.config.enabled)
        self.assertEqual(notifier.config.min_level, "INFO")
        self.assertEqual(notifier.status()["resolved_format"], "discord")
        self.assertEqual(notifier.status()["source"], "env")

    def test_invalid_environment_variable_is_ignored(self):
        with mock.patch.dict(os.environ, {"CARNET_WEBHOOK_URL": self.MASKED}, clear=False):
            notifier = AlertNotifier(self.path, journal=self.journal, transport=self.transport)
        self.assertEqual(notifier.config.url, "")
        self.assertFalse(notifier.config.enabled)
        self.assertIn("ALERT_ENV_INVALID", [code for _, code, _ in self.journal.errors])


class _RecordingJournal:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, scope, code, message):
        self.errors.append((scope, code, message))

    def warning(self, scope, code, message):
        self.warnings.append((scope, code, message))

    def info(self, scope, code, message):
        pass


class AlertApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.token = self.login()
        from test_alerts import FakeTransport

        self.transport = FakeTransport()
        self.engine.alerts.transport = self.transport
        self.engine.alerts.backoff = (0.0, 0.0, 0.0)

    def test_admin_can_configure_and_test(self):
        status, body = self.post("/api/alerts", {
            "url": "https://hooks.slack.com/services/T/B/secret", "format": "auto",
            "min_level": "CRITICAL", "enabled": True}, self.token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["alerts"]["enabled"])
        self.assertNotIn("secret", json.dumps(body))

        status, body = self.post("/api/alerts/test", {}, self.token)
        self.assertEqual(status, 200)
        self.assertTrue(body["result"]["ok"])
        self.assertEqual(body["alerts"]["sent"], 1)

        status, body = self.get("/api/alerts", self.token)
        self.assertEqual(status, 200)
        self.assertEqual(body["alerts"]["resolved_format"], "slack")

        status, body = self.post("/api/alerts/disable", {}, self.token)
        self.assertEqual(status, 200)
        self.assertFalse(body["alerts"]["enabled"])

    def test_invalid_configuration_is_refused(self):
        status, body = self.post("/api/alerts", {"url": "pas-une-url", "enabled": True},
                                 self.token)
        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "ALERT_CONFIG_INVALID")

    def test_masked_url_is_refused_with_a_clear_message(self):
        status, body = self.post("/api/alerts", {
            "url": "https://discord.com/api/webhooks/1566…/…", "enabled": True},
            self.token)
        self.assertEqual(status, 400, body)
        self.assertEqual(body["code"], "ALERT_CONFIG_INVALID")
        self.assertIn("tronquée", json.dumps(body, ensure_ascii=False))

    def test_viewer_cannot_manage_alerts(self):
        self.engine.users.create("lecteur-alertes", "Lecteur!Password2026", "VIEWER")
        token, _ = self.engine.sessions.create(
            self.engine.users.get("lecteur-alertes"), ip="127.0.0.1")
        status, _ = self.get("/api/alerts", token)
        self.assertEqual(status, 403)
        status, _ = self.post("/api/alerts/test", {}, token)
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
