"""Canaux d'alerte externes (section 19.2) — webhook générique, Slack, Discord, Teams.

Le canal est facultatif. Sa configuration vit dans ``var/alerts.json`` (droits
600), jamais en base : les URL de webhook contiennent un secret. Aucune URL ni
aucun jeton n'est écrit dans le journal ni renvoyé par l'API (masquage).

Choix d'implémentation :
- envoi hors du chemin critique (thread dédié, une alerte ne bloque jamais le
  moteur) ; l'appel de test, lui, est synchrone pour rendre un résultat ;
- réessais bornés avec attente croissante, puis abandon silencieux côté moteur
  (l'échec est journalisé et visible dans l'état du canal) ;
- aucun niveau « infrastructure » requis : un simple webhook suffit.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .util import iso, now_utc

LEVELS = {"INFO": 0, "WARNING": 1, "CRITICAL": 2, "ALERT": 3}
FORMATS = ("auto", "generic", "slack", "discord", "teams")

Transport = Callable[[str, bytes, dict[str, str], float], int]


def http_transport(url: str, payload: bytes, headers: dict[str, str], timeout: float) -> int:
    request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec - URL fournie par l'exploitant
        response.read()
        return int(getattr(response, "status", 200))


@dataclass
class AlertResult:
    ok: bool
    at: str
    attempts: int = 0
    status: int | None = None
    error: str = ""
    level: str = ""
    code: str = ""

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class AlertConfig:
    url: str = ""
    format: str = "auto"
    min_level: str = "CRITICAL"
    enabled: bool = False

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


class AlertNotifier:
    """Diffuse les notifications du centre d'alertes vers un canal externe."""

    def __init__(self, path: Path | str, journal: Any = None,
                 transport: Transport | None = None, timeout: float = 5.0,
                 retries: int = 3, backoff: tuple[float, ...] = (0.3, 0.8, 1.5)):
        self.path = Path(path)
        self.journal = journal
        self.transport = transport or http_transport
        self.timeout = timeout
        self.retries = max(1, int(retries))
        self.backoff = backoff
        self._lock = threading.RLock()
        self._config = self.load()
        self.last_result: AlertResult | None = None
        self.sent = 0
        self.failures = 0

    # -- configuration ---------------------------------------------------
    def load(self) -> AlertConfig:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return AlertConfig()
        return AlertConfig(
            url=str(data.get("url") or ""),
            format=str(data.get("format") or "auto") if data.get("format") in FORMATS else "auto",
            min_level=str(data.get("min_level") or "CRITICAL"),
            enabled=bool(data.get("enabled", False)),
        )

    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._config.to_dict(), ensure_ascii=False, indent=2),
                           encoding="utf-8")
            try:
                os.chmod(tmp, 0o600)
            except OSError:  # pragma: no cover - dépend du système de fichiers
                pass
            tmp.replace(self.path)

    @property
    def config(self) -> AlertConfig:
        return self._config

    def configure(self, url: str | None = None, format: str | None = None,
                  min_level: str | None = None, enabled: bool | None = None) -> dict[str, Any]:
        with self._lock:
            if url is not None:
                url = url.strip()
                if url and not url.lower().startswith(("https://", "http://")):
                    raise ValueError("l'URL du canal doit commencer par http:// ou https://")
                self._config.url = url
            if format is not None:
                if format not in FORMATS:
                    raise ValueError(f"format inconnu : {format} (attendu : {', '.join(FORMATS)})")
                self._config.format = format
            if min_level is not None:
                level = min_level.upper()
                if level not in LEVELS:
                    raise ValueError("niveau minimal inconnu")
                self._config.min_level = level
            if enabled is not None:
                if enabled and not self._config.url:
                    raise ValueError("impossible d'activer un canal sans URL")
                self._config.enabled = bool(enabled)
            self.save()
            return self.status()

    def disable(self) -> dict[str, Any]:
        with self._lock:
            self._config.enabled = False
            self.save()
            return self.status()

    # -- présentation ----------------------------------------------------
    def mask(self, url: str | None = None) -> str:
        target = url if url is not None else self._config.url
        if not target:
            return ""
        try:
            parts = urllib.parse.urlsplit(target)
        except ValueError:
            return "***"
        path = parts.path or ""
        if path and path != "/":
            tail = path.rstrip("/").rsplit("/", 1)[-1]
            masked_tail = f"{tail[:2]}…{tail[-2:]}" if len(tail) > 6 else "…"
            path = path[: max(0, len(path) - len(tail))] + masked_tail
        query = "?…" if parts.query else ""
        return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, "", "")) + query

    def status(self) -> dict[str, Any]:
        config = self._config
        return {
            "enabled": config.enabled,
            "configured": bool(config.url),
            "format": config.format,
            "resolved_format": self.detect_format(config.url) if config.url else "generic",
            "min_level": config.min_level,
            "url_masked": self.mask(),
            "last_result": self.last_result.to_dict() if self.last_result else None,
            "sent": self.sent,
            "failures": self.failures,
        }

    @staticmethod
    def detect_format(url: str) -> str:
        lowered = (url or "").lower()
        if "hooks.slack.com" in lowered:
            return "slack"
        if "discord.com/api/webhooks" in lowered or "discordapp.com/api/webhooks" in lowered:
            return "discord"
        if "webhook.office.com" in lowered or "outlook.office.com/webhook" in lowered:
            return "teams"
        return "generic"

    # -- message ---------------------------------------------------------
    def build_payload(self, record: dict[str, Any]) -> dict[str, Any]:
        level = str(record.get("level", "INFO")).upper()
        title = str(record.get("title") or record.get("code") or "Alerte")
        message = str(record.get("message") or "")
        code = str(record.get("code") or "")
        moment = str(record.get("created_at") or iso(now_utc()))
        chosen = self._config.format if self._config.format != "auto" \
            else self.detect_format(self._config.url)
        colors = {"INFO": "#29D6CF", "WARNING": "#F5A524", "CRITICAL": "#FF707D",
                  "ALERT": "#FF707D"}
        text = f"[{level}] {title} — {message} ({code} · {moment})"
        base = {"level": level, "code": code, "title": title, "message": message, "at": moment}
        if chosen == "slack":
            return {
                "text": text,
                "attachments": [{
                    "color": colors.get(level, "#8B98A9"),
                    "blocks": [
                        {"type": "section", "text": {"type": "mrkdwn",
                                                     "text": f"*{title}*\n{message}"}},
                        {"type": "context", "elements": [
                            {"type": "mrkdwn", "text": f"`{code}` · {level} · {moment}"}]},
                    ],
                }],
            }
        if chosen == "discord":
            return {
                "content": text,
                "embeds": [{
                    "title": title, "description": message,
                    "color": int(colors.get(level, "#8B98A9").lstrip("#"), 16),
                    "footer": {"text": f"{code} · {level}"},
                    "timestamp": moment,
                }],
            }
        if chosen == "teams":
            return {
                "@type": "MessageCard", "@context": "https://schema.org/extensions",
                "themeColor": colors.get(level, "#8B98A9").lstrip("#"),
                "summary": title,
                "sections": [{"activityTitle": title, "activitySubtitle": f"{code} · {level}",
                              "text": message, "facts": [{"name": "Horodatage", "value": moment}]}],
            }
        return base

    # -- envoi -----------------------------------------------------------
    def send(self, record: dict[str, Any]) -> AlertResult:
        """Envoi synchrone avec réessais. Renvoie le résultat détaillé."""
        if not self._config.url:
            return AlertResult(False, iso(now_utc()), error="canal non configuré",
                               level=str(record.get("level", "")), code=str(record.get("code", "")))
        payload = json.dumps(self.build_payload(record), ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "User-Agent": "CarnetDeTrading/1.0"}
        last_error = ""
        status: int | None = None
        for attempt in range(1, self.retries + 1):
            try:
                status = self.transport(self._config.url, payload, headers, self.timeout)
            except Exception as exc:  # réseau, DNS, TLS, 4xx/5xx via HTTPError
                last_error = f"{type(exc).__name__}: {exc}"[:300]
                status = getattr(exc, "code", None)
            else:
                if 200 <= status < 300:
                    result = AlertResult(True, iso(now_utc()), attempts=attempt, status=status,
                                         level=str(record.get("level", "")),
                                         code=str(record.get("code", "")))
                    self._finish(result, success=True)
                    return result
                last_error = f"réponse HTTP {status}"[:300]
            if attempt < self.retries and self.backoff:
                time.sleep(min(2.0, float(self.backoff[min(attempt - 1, len(self.backoff) - 1)])))
        result = AlertResult(False, iso(now_utc()), attempts=self.retries, status=status,
                             error=last_error or "échec inconnu",
                             level=str(record.get("level", "")), code=str(record.get("code", "")))
        self._finish(result, success=False)
        return result

    def _finish(self, result: AlertResult, success: bool) -> None:
        self.last_result = result
        if success:
            self.sent += 1
        else:
            self.failures += 1
            if self.journal:
                self.journal.error(
                    "notify", "ALERT_CHANNEL_FAILED",
                    f"canal d'alerte en échec après {result.attempts} tentative(s) : {result.error}")

    # -- branchement sur le centre de notifications ----------------------
    def hook(self, record: dict[str, Any]) -> None:
        """Hook synchrone appelé par ``Notifications`` : planifie l'envoi."""
        if not self._config.enabled or not self._config.url:
            return
        level = str(record.get("level", "INFO")).upper()
        if LEVELS.get(level, 0) < LEVELS.get(self._config.min_level, 2):
            return
        threading.Thread(target=self.send, args=(record,), daemon=True,
                         name="carnet-alert").start()

    def test(self) -> dict[str, Any]:
        record = {
            "level": "CRITICAL", "code": "ALERT_TEST", "title": "Test du canal d'alerte",
            "message": "Si ce message est visible, le canal est correctement configuré.",
            "created_at": iso(now_utc()),
        }
        return self.send(record).to_dict()
