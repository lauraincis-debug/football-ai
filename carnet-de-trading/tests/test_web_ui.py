"""Cohérence statique de l'interface (aucun navigateur requis).

L'environnement de développement n'a pas de binaire de navigateur : ces tests
remplacent le test end-to-end pour les régressions structurelles — identifiants
HTML référencés par le JS, routes utilisées par le client, liaisons des nouveaux
panneaux (pont MT5, canal d'alerte) et absence de gestionnaire inline (CSP).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
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
        "mt5-server", "mt5-login", "mt5-suffix", "mt5-symbol-map", "mt5-enabled",
        "mt5-orders",
        "btn-mt5-test", "btn-mt5-disable", "mt5-badge", "mt5-status", "mt5-error",
        "alerts-card", "alerts-form", "alert-url", "alert-format", "alert-level",
        "alert-enabled", "btn-alert-test", "btn-alert-disable", "alerts-badge",
        "alerts-status", "alerts-error", "mt5-instruments", "mt5-instruments-box",
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

    def test_symbol_map_parsing(self):
        self.assertIn("function parseSymbolMap(text)", APP)
        self.assertIn("symbol_map: parseSymbolMap(", APP)
        self.assertIn("EURUSD=frxEURUSD", HTML)

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


class PwaTests(unittest.TestCase):
    """Installation sur l'écran d'accueil : icônes, manifest, service worker."""

    def test_manifest_declares_installable_icons(self):
        manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
        sources = {icon["src"] for icon in manifest["icons"]}
        for required in ("/icons/icon-192.png", "/icons/icon-512.png",
                         "/icons/icon-maskable-512.png"):
            self.assertIn(required, sources)
        sizes = {icon.get("sizes") for icon in manifest["icons"]}
        self.assertIn("192x192", sizes)
        self.assertIn("512x512", sizes)
        self.assertTrue(any(icon.get("purpose") == "maskable" for icon in manifest["icons"]))
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual(manifest["lang"], "fr")

    def test_html_links_apple_and_png_icons(self):
        self.assertIn('rel="apple-touch-icon"', HTML)
        self.assertIn("/icons/apple-touch-icon.png", HTML)
        self.assertIn('rel="manifest"', HTML)

    def test_service_worker_caches_shell_and_icons(self):
        sw = (WEB / "sw.js").read_text(encoding="utf-8")
        for asset in ("/styles.css", "/js/app.js", "/manifest.webmanifest",
                      "/icons/icon-192.png"):
            self.assertIn(asset, sw)
        self.assertIn("carnet-shell-v4", sw)
        self.assertIn('url.pathname.startsWith("/api/")', sw)

    def test_png_files_have_expected_dimensions(self):
        import struct

        expected = {
            "icon-192.png": (192, 192),
            "icon-512.png": (512, 512),
            "icon-maskable-512.png": (512, 512),
            "apple-touch-icon.png": (180, 180),
        }
        for name, (width, height) in expected.items():
            data = (WEB / "icons" / name).read_bytes()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n", name)
            got_w, got_h = struct.unpack(">II", data[16:24])
            self.assertEqual((got_w, got_h), (width, height), name)
            self.assertLess(len(data), 200_000, f"{name} trop lourd pour un lanceur")


class DashboardFormattingTests(unittest.TestCase):
    """Le tableau de bord ne doit jamais s'interrompre sur un formatage.

    Régression : `signed(perf.realized_pnl + perf.unrealized, currency)` passait la
    devise à la place du nombre de décimales ; `Intl.NumberFormat` levait un
    RangeError et tout le rendu situé après la carte « P&L net » restait vide.
    """

    HELPERS = ("function num(", "function priceDigits(")

    def _js_helpers(self) -> str:
        start = APP.index(self.HELPERS[0])
        end = APP.index(self.HELPERS[1])
        return APP[start:end]

    @staticmethod
    def _calls(source: str, name: str) -> list[list[str]]:
        """Découpe les arguments de chaque appel ``name(...)`` au premier niveau."""
        calls: list[list[str]] = []
        needle = f"{name}("
        index = source.find(needle)
        while index != -1:
            if source[max(0, index - 9):index] == "function ":
                index = source.find(needle, index + len(needle))
                continue
            depth, current, args, i = 1, "", [], index + len(needle)
            while i < len(source) and depth:
                char = source[i]
                if char == "(":
                    depth += 1
                elif char == ")":
                    depth -= 1
                    if not depth:
                        break
                if char == "," and depth == 1:
                    args.append(current.strip())
                    current = ""
                else:
                    current += char
                i += 1
            args.append(current.strip())
            calls.append([arg for arg in args if arg])
            index = source.find(needle, i)
        return calls

    def test_signed_second_argument_is_numeric(self):
        for args in self._calls(APP, "signed"):
            if len(args) >= 2:
                self.assertRegex(
                    args[1], r"^(\d+|digits)$",
                    f"signed({', '.join(args)}) : le 2e argument doit être un nombre "
                    "de décimales, pas une devise")

    def test_money_third_argument_is_numeric(self):
        for args in self._calls(APP, "money"):
            if len(args) >= 3:
                self.assertRegex(
                    args[2], r"^(\d+|digits)$",
                    f"money({', '.join(args)}) : le 3e argument doit être un nombre "
                    "de décimales")

    def test_dashboard_pnl_call_passes_digits_before_currency(self):
        self.assertIn(
            "signed(perf.realized_pnl + perf.unrealized, 2, currency)", APP)

    def test_num_coerces_invalid_digits(self):
        helpers = self._js_helpers()
        self.assertIn("Number.isInteger(places)", helpers)
        self.assertIn("const fraction =", helpers)

    @unittest.skipUnless(shutil.which("node"), "node absent : test d'exécution ignoré")
    def test_helpers_render_instead_of_throwing(self):
        helpers = self._js_helpers()
        script = helpers + """
const out = {
  money: money(1234.5, "USD"),
  signed: signed(-50.71, "USD"),
  numAuto: num(1234.5, "auto"),
  numNeg: num(-2.5, -3),
};
process.stdout.write(JSON.stringify(out));
"""
        result = subprocess.run(
            ["node", "-e", script], capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        normalize = lambda value: value.replace("\u202f", " ").replace("\u00a0", " ")
        self.assertEqual(normalize(payload["money"]), "1 234,50$")
        self.assertEqual(normalize(payload["signed"]), "-50,71$")
        self.assertEqual(normalize(payload["numAuto"]), "1 234,50")
        self.assertEqual(normalize(payload["numNeg"]), "-2,50")


class AlertFormSafetyTests(unittest.TestCase):
    """Le champ webhook ne doit jamais renvoyer l'URL masquée (« … »).

    Régression observée en production : le formulaire réaffichait le masque, la
    sauvegarde l'enregistrait, puis chaque envoi échouait en ASCII.
    """

    def test_masked_url_is_never_written_into_the_input(self):
        self.assertNotIn('$("#alert-url").value = alerts.url_masked', APP)
        self.assertIn('alertUrlInput.value = "";', APP)
        self.assertIn("alertUrlInput.placeholder", APP)
        self.assertIn("enregistré :", APP)

    def test_user_edits_are_tracked(self):
        self.assertIn("alertUrlDirty", APP)
        self.assertIn('$("#alert-url").addEventListener("input"', APP)

    def test_save_refuses_an_ellipsis_url(self):
        self.assertIn('url.includes("…")', APP)
        self.assertIn("URL tronquée", APP)

    def test_dirty_flag_is_cleared_after_success(self):
        self.assertIn("app.alertUrlDirty = false;", APP)

    def test_auto_disabled_state_is_surfaced(self):
        self.assertIn("auto_disabled", APP)
        self.assertIn("désactivé automatiquement", APP)
        self.assertIn('alerts.source === "env"', APP)


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
