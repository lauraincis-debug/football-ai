"""Canaux d'alerte externes (section 19.2) : formatage, réessais, secret, API."""

from __future__ import annotations

import json
import os
import unittest

from helpers import ApiTestCase, TempProject

from carnet.alerts import AlertNotifier


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
