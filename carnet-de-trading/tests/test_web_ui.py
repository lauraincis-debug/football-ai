"""Cohérence statique de l'interface (aucun navigateur requis).

L'environnement de développement n'a pas de binaire de navigateur : ces tests
remplacent le test end-to-end pour les régressions structurelles — identifiants
HTML référencés par le JS, routes utilisées par le client, liaisons des nouveaux
panneaux (pont MT5, canal d'alerte) et absence de gestionnaire inline (CSP).
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
HTML = (WEB / "index.html").read_text(encoding="utf-8")
APP = (WEB / "js" / "app.js").read_text(encoding="utf-8")
API = (WEB / "js" / "api.js").read_text(encoding="utf-8")


def html_ids() -> set[str]:
    return set(re.findall(r'id="([^"]+)"', HTML))


def js_id_references() -> set[str]:
    """Sélecteurs `$("#…")` simples (les sélecteurs composés sont ignorés)."""
    raw = set(re.findall(r'\$\("#([^"\)]+)"\)', APP))
    return {value for value in raw if " " not in value and ">" not in value}


class HtmlReferenceTests(unittest.TestCase):
    def test_every_simple_selector_exists_in_html(self):
        missing = sorted(js_id_references() - html_ids())
        self.assertEqual(missing, [], f"identifiants référencés mais absents : {missing}")

    def test_navigation_views_exist(self):
        targets = set(re.findall(r'data-nav="([^"]+)"', HTML))
        views = {identifier[5:] for identifier in html_ids() if identifier.startswith("view-")}
        self.assertTrue(targets)
        self.assertEqual(sorted(targets - views), [])

    def test_no_inline_event_handlers(self):
        inline = re.findall(r"<[^>]+\son(?:click|change|submit|input)=", HTML, flags=re.IGNORECASE)
        self.assertEqual(inline, [], "les attributs on* violent la CSP")

    def test_security_meta_and_module_script(self):
        self.assertIn('type="module"', HTML)
        self.assertIn("/js/app.js", HTML)
        self.assertIn("viewport", HTML)


class ConnectionsPanelTests(unittest.TestCase):
    """Le panneau MT5/alertes doit rester complet et câblé."""

    REQUIRED_IDS = {
        "connections-grid", "mt5-card", "mt5-form", "mt5-url", "mt5-token", "mt5-broker",
        "mt5-server", "mt5-login", "mt5-suffix", "mt5-enabled", "mt5-orders",
        "btn-mt5-test", "btn-mt5-disable", "mt5-badge", "mt5-status", "mt5-error",
        "alerts-card", "alerts-form", "alert-url", "alert-format", "alert-level",
        "alert-enabled", "btn-alert-test", "btn-alert-disable", "alerts-badge",
        "alerts-status", "alerts-error",
    }

    def test_panel_controls_present(self):
        self.assertEqual(sorted(self.REQUIRED_IDS - html_ids()), [])

    def test_handlers_bound(self):
        for selector, handler in (
            ("#mt5-form", "onSaveMt5"),
            ("#btn-mt5-test", "onTestMt5"),
            ("#btn-mt5-disable", "onDisableMt5"),
            ("#alerts-form", "onSaveAlerts"),
            ("#btn-alert-test", "onTestAlerts"),
            ("#btn-alert-disable", "onDisableAlerts"),
        ):
            binding = re.search(
                re.escape(f'$("{selector}").addEventListener(') + r'"([a-z]+)", ' + handler, APP)
            self.assertIsNotNone(binding, f"{selector} non relié à {handler}")
            self.assertIn(f"function {handler}", APP)

    def test_panels_are_rendered_from_state(self):
        self.assertIn("renderConnections(state)", APP)
        self.assertIn("state.mt5_connection", APP)
        self.assertIn("state.alerts", APP)
        # Les cartes plateformes ne doivent plus dépendre d'un « kind » absent.
        self.assertNotIn('connectors.find((c) => c.kind === "mt5")', APP)
        self.assertIn("descriptor.kind === \"mt5\"", APP)

    def test_admin_only_visibility(self):
        self.assertIn('const isAdmin = app.user?.role === "ADMIN";', APP)
        self.assertIn('grid.classList.toggle("hidden", !isAdmin)', APP)

    def test_api_routes_match_backend(self):
        for route in ("/api/connections", "/api/connections/mt5",
                      "/api/connections/mt5/test", "/api/connections/mt5/disable",
                      "/api/alerts", "/api/alerts/test", "/api/alerts/disable"):
            self.assertIn(route, API, route)


class ApiClientTests(unittest.TestCase):
    def test_every_api_call_is_implemented(self):
        used = set(re.findall(r"\bapi\.([a-zA-Z][A-Za-z0-9]*)\(", APP))
        implemented = set(re.findall(r"^\s{2}([a-zA-Z][A-Za-z0-9]*):", API, flags=re.MULTILINE))
        implemented |= set(re.findall(r"async ([a-zA-Z][A-Za-z0-9]*)\(path", API))
        ignorable = {"token", "clear", "loadToken", "setToken"}
        missing = sorted(used - implemented - ignorable)
        self.assertEqual(missing, [], f"méthodes absentes de api.js : {missing}")

    def test_session_token_sent_as_header(self):
        self.assertIn("Authorization", API)
        self.assertIn("sessionStorage", API)
        self.assertNotIn("document.cookie", API)


if __name__ == "__main__":
    unittest.main()
