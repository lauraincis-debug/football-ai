/**
 * Carnet de Trading — application cliente.
 * Aucun framework : modules ES + rendu ciblé. Le serveur reste la seule
 * source de vérité (état, risque, ordres) ; l'interface ne calcule rien qui
 * engage du capital.
 */

import { api, ApiError } from "./api.js";
import { drawCandles, drawEquityChart, drawLoginBackdrop } from "./charts.js";

const POLL_STATE_MS = 3000;
const POLL_MARKET_MS = 5000;

const app = {
  view: "dashboard",
  timeframe: "15m",
  symbol: "EURUSD",
  state: null,
  user: null,
  strategies: [],
  symbols: [],
  journal: { entries: [], level: "", search: "" },
  diagnostics: null,
  backtest: null,
  busy: false,
  lastStateAt: 0,
  loginInfo: null,
  mfaSecret: null,
  timer: null,
  marketTimer: null,
};

/* ------------------------------------------------------------------ utils */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function num(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function money(value, currency = "USD", digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const suffix = currency === "USD" ? "$" : ` ${currency}`;
  return `${num(n, digits)}${suffix}`;
}

function signed(value, digits = 2, currency = "USD") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${money(n, currency, digits)}`;
}

function pct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${num(n, digits)} %`;
}

function priceDigits(symbol) {
  const spec = app.symbols.find((s) => s.symbol === symbol);
  return spec ? spec.price_precision : 5;
}

function fmtPrice(value, symbol) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return num(n, priceDigits(symbol));
}

function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const delta = Math.max(0, (Date.now() - then) / 1000);
  if (delta < 60) return `il y a ${Math.round(delta)} s`;
  if (delta < 3600) return `il y a ${Math.round(delta / 60)} min`;
  if (delta < 86400) return `il y a ${Math.round(delta / 3600)} h`;
  return `il y a ${Math.round(delta / 86400)} j`;
}

function clock(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function toast(title, message = "", kind = "") {
  const host = $("#toasts");
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}`;
  host.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 250);
  }, 4200);
}

function setError(selector, message) {
  const node = $(selector);
  if (node) node.textContent = message || "";
}

function confirmAction({ title, text, requireText = null, confirmLabel = "Confirmer" }) {
  return new Promise((resolve) => {
    const dialog = $("#confirm-dialog");
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    const wrap = $("#confirm-input-wrap");
    const input = $("#confirm-input");
    const ok = $("#confirm-ok");
    if (requireText) {
      wrap.classList.remove("hidden");
      $("#confirm-input-label").textContent = `Saisissez « ${requireText} » pour confirmer`;
      input.value = "";
      input.required = true;
    } else {
      wrap.classList.add("hidden");
      input.value = "";
      input.required = false;
    }
    ok.textContent = confirmLabel;
    const cleanup = () => {
      dialog.close();
      dialog.removeEventListener("close", onClose);
      ok.removeEventListener("click", onClick);
    };
    const onClose = () => {
      const value = input.value;
      cleanup();
      resolve(dialog.returnValue === "ok" && (!requireText || value.trim().toUpperCase() === requireText.toUpperCase()));
    };
    const onClick = (event) => {
      if (requireText && input.value.trim().toUpperCase() !== requireText.toUpperCase()) {
        event.preventDefault();
        input.focus();
        return;
      }
      dialog.returnValue = "ok";
    };
    dialog.addEventListener("close", onClose, { once: true });
    ok.addEventListener("click", onClick);
    dialog.showModal();
    if (requireText) setTimeout(() => input.focus(), 60);
  });
}

/* ------------------------------------------------------------------ auth */
function showLogin(info) {
  app.loginInfo = info;
  $("#boot").classList.add("hidden");
  $("#app-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
  const banner = $("#login-banner");
  if (info?.banner) {
    banner.innerHTML = `<strong>${escapeHtml(info.banner.text)}.</strong><span>${escapeHtml(info.banner.detail || "")}</span>`;
  }
  drawLoginBackdrop($("#login-canvas"));
  $("#login-username").focus();
}

async function handleLogin(event) {
  event.preventDefault();
  const button = $("#login-submit");
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  const code = $("#login-code").value.trim();
  setError("#login-error", "");
  if (!username || !password) {
    setError("#login-error", "Identifiant et mot de passe sont requis.");
    return;
  }
  button.disabled = true;
  button.textContent = "Connexion…";
  try {
    const result = await api.login(username, password, code || undefined);
    api.setToken(result.token);
    app.user = result.user;
    $("#login-form").reset();
    await startApp();
  } catch (error) {
    if (error.code === "MFA_REQUIRED") {
      $("#login-code-field").classList.add("highlight");
      setError("#login-error", "Code MFA requis ou invalide.");
      $("#login-code").focus();
    } else {
      setError("#login-error", error.message || "Connexion impossible.");
    }
  } finally {
    button.disabled = false;
    button.textContent = "Se connecter";
  }
}

async function logout() {
  try {
    await api.logout();
  } catch {
    /* la session sera de toute façon invalidée côté client */
  }
  api.clear();
  app.user = null;
  app.state = null;
  clearInterval(app.timer);
  clearInterval(app.marketTimer);
  const info = await api.publicInfo().catch(() => null);
  showLogin(info);
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  api.loadToken();
  let info = null;
  try {
    info = await api.publicInfo();
  } catch (error) {
    $("#boot").innerHTML = `<div class="boot-mark">!</div><p>${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!api.token) {
    showLogin(info);
    return;
  }
  try {
    const me = await api.me();
    app.user = me.user;
    await startApp();
  } catch {
    api.clear();
    showLogin(info);
  }
}

async function startApp() {
  $("#boot").classList.add("hidden");
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#user-name").textContent = app.user.username;
  $("#user-role").textContent = app.user.role;
  $("#user-avatar").textContent = app.user.username.slice(0, 2).toUpperCase();
  if (!app.symbols.length) {
    try {
      const data = await api.symbols();
      app.symbols = data.symbols || [];
    } catch {
      app.symbols = [];
    }
  }
  await refreshState();
  await refreshStrategies();
  populateSelects();
  navigate(app.view || "dashboard");
  clearInterval(app.timer);
  app.timer = setInterval(() => {
    if (document.hidden) return;
    refreshState().catch(() => {});
  }, POLL_STATE_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshState().catch(() => {});
  });
}

/* ------------------------------------------------------------------ data */
async function refreshState() {
  const state = await api.state();
  app.state = state;
  app.lastStateAt = Date.now();
  if (!app.user && state) {
    // rien : l'utilisateur est renseigné à la connexion
  }
  renderShell();
  renderCurrentView();
}

async function refreshStrategies() {
  try {
    const data = await api.strategies();
    app.strategies = data.strategies || [];
  } catch {
    app.strategies = [];
  }
}

function populateSelects() {
  const strategySelect = $("#bt-strategy");
  if (strategySelect) {
    strategySelect.innerHTML = app.strategies
      .map((s) => `<option value="${escapeHtml(s.key)}">${escapeHtml(s.label)}</option>`)
      .join("");
  }
  const symbolsSelect = $("#bt-symbols");
  if (symbolsSelect) {
    symbolsSelect.innerHTML = app.symbols
      .map((s) => `<option value="${escapeHtml(s.symbol)}"${["EURUSD", "BTCUSDT"].includes(s.symbol) ? " selected" : ""}>${escapeHtml(s.display_name || s.symbol)}</option>`)
      .join("");
  }
  const symbolList = $("#symbol-list");
  if (symbolList) {
    symbolList.innerHTML = app.symbols
      .map((s) => `<button class="symbol-item" data-symbol="${escapeHtml(s.symbol)}">
        <span>${escapeHtml(s.display_name || s.symbol)}</span>
        <span class="price mono" data-symbol-price="${escapeHtml(s.symbol)}">—</span>
      </button>`)
      .join("");
    symbolList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-symbol]");
      if (!button) return;
      app.symbol = button.dataset.symbol;
      renderMarkets().catch(() => {});
      loadCandles().catch(() => {});
    });
  }
  const policyField = $("#policy-field");
  if (policyField && app.state) {
    policyField.innerHTML = Object.keys(app.state.risk.policy)
      .filter((key) => key !== "version")
      .map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`)
      .join("");
  }
}

/* ------------------------------------------------------------------ shell */
function renderShell() {
  const state = app.state;
  if (!state) return;
  const banner = state.banner;
  const strip = $("#env-strip");
  strip.className = `env-strip ${banner.level === "REAL" ? "real" : banner.level === "DEMO" ? "demo" : "sim"}`;
  strip.innerHTML = `<span class="dot ${banner.level === "REAL" ? "" : "dot-live"}"></span>${escapeHtml(
    banner.level === "SIMULATION" ? "SIMULATION" : banner.level === "DEMO" ? "DÉMO" : "RÉEL"
  )}`;

  const main = $("#banner-main");
  if (main) {
    main.className = `banner ${banner.level === "REAL" ? "banner-real" : "banner-sim"}`;
    main.innerHTML = `<strong>${escapeHtml(banner.text)}</strong><span class="muted">${escapeHtml(banner.detail || "")}</span>`;
  }
  const marketsBanner = $("#banner-markets");
  if (marketsBanner) {
    marketsBanner.innerHTML = `<strong>Données de simulation.</strong><span>Aucun flux broker n'est connecté : les prix proviennent du générateur déterministe (seed ${escapeHtml(
      String(state.simulation?.speed ?? "")
    )}× temps simulé).</span>`;
  }

  const perf = state.performance;
  $("#top-equity").textContent = money(perf.equity, state.account.currency);
  const pnlNode = $("#top-pnl");
  pnlNode.textContent = pct(perf.return_pct);
  pnlNode.className = `delta mono ${perf.return_pct >= 0 ? "up" : "down"}`;

  const badge = $("#notif-badge");
  badge.textContent = String(state.unread_notifications || 0);
  badge.classList.toggle("hidden", !state.unread_notifications);

  const clockNode = $("#sim-clock");
  if (clockNode) clockNode.textContent = dateTime(state.simulation?.clock || state.server_time);
  const note = $("#engine-note");
  if (note) note.textContent = `moteur ${state.app.state.toLowerCase()} · ${state.app.tick_count} cycles`;

  const statusEngine = $("#status-engine");
  statusEngine.textContent = `moteur ${state.app.state.toLowerCase()}`;
  statusEngine.style.color = state.app.state === "RUNNING" ? "var(--gain)" : "var(--warn)";
  $("#status-db").textContent = `base ${state.journal.total} événements`;
  const recon = state.reconciliation;
  $("#status-recon").textContent = `réconciliation ${recon ? recon.status.toLowerCase() : "—"}`;
  $("#status-recon").style.color = recon?.status === "OK" ? "var(--gain)" : "var(--loss)";
  $("#status-notif").textContent = `alertes ${state.unread_notifications}`;
  $("#status-time").textContent = `serveur ${clock(state.server_time)}`;
  $("#brand-version").textContent = `v${state.app.version}`;

  const pillEntries = $("#pill-entries");
  if (pillEntries) {
    const enabled = state.risk.entries_enabled && !state.risk.suspended;
    pillEntries.className = `pill ${enabled ? "ok" : "bad"}`;
    pillEntries.textContent = enabled
      ? "Entrées autorisées"
      : state.risk.kill_switch
        ? "Arrêt d'urgence"
        : `Entrées bloquées${state.risk.suspension_reason ? ` · ${state.risk.suspension_reason}` : ""}`;
  }
  const pillRecon = $("#pill-recon");
  if (pillRecon) {
    pillRecon.className = `pill ${recon?.status === "OK" ? "ok" : "warn"}`;
    pillRecon.textContent = `Réconciliation ${recon ? recon.status : "—"}`;
  }
  const pillOrders = $("#pill-orders");
  if (pillOrders) pillOrders.textContent = `${state.orders.length} ordres · ${state.positions.length} positions`;
  const pillFees = $("#pill-fees");
  if (pillFees) pillFees.textContent = `frais ${money(perf.fees, state.account.currency)}`;
  const pillPolicy = $("#pill-policy");
  if (pillPolicy) pillPolicy.textContent = `politique v${state.risk.policy.version}`;
}

/* ------------------------------------------------------------------ router */
const VIEW_RENDERERS = {
  dashboard: renderDashboard,
  markets: renderMarkets,
  trading: renderTrading,
  strategies: renderStrategies,
  risk: renderRisk,
  journal: renderJournal,
  settings: renderSettings,
};

function navigate(view) {
  if (!VIEW_RENDERERS[view]) view = "dashboard";
  app.view = view;
  $$(".view").forEach((section) => section.classList.add("hidden"));
  $(`#view-${view}`)?.classList.remove("hidden");
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.nav === view));
  $("#sidebar").classList.remove("open");
  $("#menu-btn").setAttribute("aria-expanded", "false");
  renderCurrentView();
  if (view === "markets") loadCandles().catch(() => {});
  if (view === "journal") refreshJournal().catch(() => {});
  window.location.hash = view;
}

function renderCurrentView() {
  const renderer = VIEW_RENDERERS[app.view];
  if (renderer && app.state) {
    try {
      Promise.resolve(renderer()).catch((error) => console.error(error));
    } catch (error) {
      console.error(error);
    }
  }
}

/* ------------------------------------------------------------------ dashboard */
function renderDashboard() {
  const state = app.state;
  const perf = state.performance;
  const currency = state.account.currency;
  $("#kpi-equity").textContent = money(perf.equity, currency);
  const ret = $("#kpi-return");
  ret.textContent = pct(perf.return_pct);
  ret.className = `delta ${perf.return_pct >= 0 ? "up" : "down"}`;
  const pnl = $("#kpi-pnl");
  pnl.textContent = signed(perf.realized_pnl + perf.unrealized, currency);
  pnl.style.color = perf.realized_pnl + perf.unrealized >= 0 ? "var(--gain)" : "var(--loss)";
  $("#kpi-fees").textContent = money(perf.fees, currency);
  $("#kpi-open-risk").textContent = money(state.risk.open_risk, currency);
  $("#kpi-open-positions").textContent = `${state.risk.open_positions ?? state.positions.length} position(s) · ${num(
    state.risk.open_risk_pct,
    2
  )} % du capital`;
  $("#kpi-margin").textContent = money(state.account.free_margin, currency);
  $("#kpi-margin-level").textContent = state.account.margin_level
    ? `niveau de marge ${num(state.account.margin_level, 1)} %`
    : "aucune marge utilisée";

  const metrics = state.metrics || {};
  const curve = (metrics.equity_curve || []).map((point) => point.equity);
  $("#equity-range").textContent = curve.length
    ? `${curve.length} points · max DD ${num(metrics.max_drawdown_pct, 2)} %`
    : "collecte en cours";
  drawEquityChart($("#chart-equity"), curve.length ? curve : [perf.initial_capital, perf.equity], {
    height: 220,
    baseline: perf.initial_capital,
  });

  renderLimits();
  renderPositionsTable($("#table-positions"), state.positions);
  $("#positions-count").textContent = `${state.positions.length} / ${state.risk.policy.max_open_positions}`;
  renderSignals();
  renderMarketGrid();
}

function renderLimits() {
  const state = app.state;
  const risk = state.risk;
  const policy = risk.policy;
  const rows = [
    { label: "Perte journalière", used: risk.daily_loss_pct, max: policy.max_daily_loss_pct },
    { label: "Perte hebdomadaire", used: risk.weekly_loss_pct, max: policy.max_weekly_loss_pct },
    { label: "Drawdown global", used: risk.drawdown_pct, max: policy.max_drawdown_pct },
    { label: "Risque cumulé ouvert", used: risk.open_risk_pct, max: policy.max_open_risk_pct },
    {
      label: "Positions simultanées",
      used: state.positions.length,
      max: policy.max_open_positions,
      raw: true,
    },
  ];
  $("#limit-list").innerHTML = rows
    .map((row) => {
      const ratio = row.max ? Math.min(100, (Number(row.used) / Number(row.max)) * 100) : 0;
      const level = ratio >= 90 ? "danger" : ratio >= 60 ? "warn" : "";
      const shown = row.raw ? `${row.used} / ${row.max}` : `${num(row.used, 2)} % / ${num(row.max, 2)} %`;
      return `<div class="limit">
        <div class="limit-top"><span>${escapeHtml(row.label)}</span><span>${shown}</span></div>
        <div class="bar ${level}"><i style="width:${ratio.toFixed(1)}%"></i></div>
      </div>`;
    })
    .join("");
}

function renderPositionsTable(table, positions) {
  if (!table) return;
  const body = table.querySelector("tbody");
  if (!positions.length) {
    body.innerHTML = `<tr class="empty"><td colspan="8">Aucune position ouverte.</td></tr>`;
    return;
  }
  body.innerHTML = positions
    .map(
      (p) => `<tr>
        <td><strong>${escapeHtml(p.symbol)}</strong><br><small class="muted">${escapeHtml(p.strategy || "—")}</small></td>
        <td><span class="tag ${p.side === "BUY" ? "buy" : "sell"}">${p.side === "BUY" ? "ACHAT" : "VENTE"}</span></td>
        <td class="num">${num(p.qty, 4)}</td>
        <td class="num">${fmtPrice(p.entry_price, p.symbol)}</td>
        <td class="num">${fmtPrice(p.stop_price, p.symbol)}</td>
        <td class="num">${fmtPrice(p.target_price, p.symbol)}</td>
        <td class="num ${Number(p.unrealized_pnl) >= 0 ? "pos" : "neg"}">${signed(p.unrealized_pnl, 2, app.state.account.currency)}</td>
        <td><span class="tag ${p.protection_ok ? "ok" : "bad"}">${p.protection_ok ? "protégée" : "non confirmée"}</span></td>
      </tr>`
    )
    .join("");
}

function renderSignals() {
  const host = $("#signal-feed");
  const signals = app.state.signals || [];
  if (!signals.length) {
    host.innerHTML = `<p class="muted small">Aucun signal pour l'instant. Les stratégies n'envoient un signal que lorsqu'elles détectent une configuration complète.</p>`;
    return;
  }
  host.innerHTML = signals
    .slice(0, 8)
    .map((signal) => {
      const allowed = signal.allowed === 1 || signal.allowed === true;
      const label = allowed ? "autorisé" : signal.code || "refusé";
      return `<div class="feed-item ${allowed ? "ok" : "bad"}">
        <span class="tag ${signal.side === "BUY" ? "buy" : "sell"}">${signal.side === "BUY" ? "A" : "V"}</span>
        <div class="feed-main">
          <strong>${escapeHtml(signal.strategy)} · ${escapeHtml(signal.symbol)}</strong>
          <small>${escapeHtml((signal.reasons || [])[0] || "")}</small>
        </div>
        <div class="feed-meta">
          <span class="tag ${allowed ? "ok" : "warn"}">${escapeHtml(label)}</span><br>
          <small>${timeAgo(signal.created_at)}</small>
        </div>
      </div>`;
    })
    .join("");
}

function renderMarketGrid() {
  const host = $("#market-grid");
  const market = app.state.market || [];
  host.innerHTML = market
    .map((quote) => {
      const available = quote.available !== false;
      const problems = quote.issues || [];
      const cls = !available ? "closed" : problems.length ? "stale" : "";
      return `<div class="market-tile ${cls}" data-market="${escapeHtml(quote.symbol)}">
        <header>
          <span class="sym">${escapeHtml(quote.symbol)}</span>
          <span class="tag ${quote.fresh ? "ok" : "warn"}">${quote.fresh ? "frais" : quote.market_open === false ? "fermé" : "à vérifier"}</span>
        </header>
        <div class="px">${available ? fmtPrice(quote.mid, quote.symbol) : "—"}</div>
        <div class="meta">
          <span>spread ${available ? num(quote.spread_bps, 1) : "—"} bps</span>
          <span>${available ? `${num(quote.age_seconds, 1)} s` : "hors session"}</span>
        </div>
      </div>`;
    })
    .join("");
  host.querySelectorAll("[data-market]").forEach((tile) => {
    tile.addEventListener("click", () => {
      app.symbol = tile.dataset.market;
      navigate("markets");
    });
  });
}

/* ------------------------------------------------------------------ markets */
function renderMarkets() {
  const market = app.state.market || [];
  market.forEach((quote) => {
    const node = $(`[data-symbol-price="${quote.symbol}"]`);
    if (node) node.textContent = quote.available === false ? "—" : fmtPrice(quote.mid, quote.symbol);
  });
  $$(".symbol-item").forEach((item) => item.classList.toggle("active", item.dataset.symbol === app.symbol));
  const quote = market.find((q) => q.symbol === app.symbol);
  $("#chart-title").textContent = app.symbol;
  $("#chart-meta").textContent = `${app.timeframe} · marché simulé`;
  $("#chart-quote").innerHTML = quote && quote.available !== false
    ? `<span>bid ${fmtPrice(quote.bid, quote.symbol)}</span>
       <span>ask ${fmtPrice(quote.ask, quote.symbol)}</span>
       <span class="${quote.fresh ? "muted" : ""}">spread ${num(quote.spread_bps, 1)} bps</span>
       <span class="muted">${num(quote.age_seconds, 1)} s</span>`
    : `<span class="muted">hors session ou donnée indisponible</span>`;

  const checks = [
    ["Cotation disponible", quote && quote.available !== false, quote ? "ok" : "absente"],
    ["Fraîcheur ≤ 3 s", quote ? quote.fresh : false, quote ? `${num(quote.age_seconds, 2)} s` : "—"],
    ["Spread dans la limite", quote ? !(quote.issues || []).some((i) => i.startsWith("SPREAD")) : false,
      quote ? `${num(quote.spread_bps, 1)} bps / ${num(app.state.risk.policy.max_spread_bps, 1)}` : "—"],
    ["Session ouverte", quote ? quote.market_open !== false : false, quote?.session || "—"],
    ["Instrument protégé", true, "stop + objectif obligatoires"],
  ];
  $("#market-checks").innerHTML = checks
    .map(([label, ok, detail]) => `<div class="check ${ok ? "ok" : "bad"}">
      <span class="mark">${ok ? "✓" : "!"}</span><span>${escapeHtml(label)}</span>
      <span class="detail">${escapeHtml(detail)}</span></div>`)
    .join("");

  const indicators = app.state.indicators?.[app.symbol];
  const grid = $("#indicator-grid");
  if (!indicators || indicators.ready === false) {
    grid.innerHTML = `<p class="muted small">Indicateurs en cours de constitution (${escapeHtml(
      String(indicators?.samples ?? 0)
    )} bougies).</p>`;
  } else {
    const rows = [
      ["EMA 12", indicators.ema_fast],
      ["EMA 26", indicators.ema_slow],
      ["EMA 50", indicators.ema_trend],
      ["RSI 14", indicators.rsi14],
      ["ATR 14", indicators.atr14],
      ["Position dans le range", indicators.range_position !== undefined ? `${num(indicators.range_position * 100, 1)} %` : "—"],
    ];
    grid.innerHTML = rows
      .map(([label, value]) => `<div class="kv"><span>${escapeHtml(label)}</span><strong>${
        typeof value === "number" ? num(value, app.symbol.includes("JPY") ? 3 : 5) : escapeHtml(value ?? "—")
      }</strong></div>`)
      .join("");
  }
}

async function loadCandles() {
  const data = await api.candles(app.symbol, app.timeframe, 220);
  drawCandles($("#chart-candles"), data.candles, {
    height: 360,
    precision: priceDigits(app.symbol),
  });
  const legend = $("#chart-legend");
  if (legend) {
    const last = data.candles[data.candles.length - 1];
    legend.innerHTML = `<span>Dernière bougie ${clock(last?.time)}</span>
      <span>O ${fmtPrice(last?.open, app.symbol)} · H ${fmtPrice(last?.high, app.symbol)} ·
      B ${fmtPrice(last?.low, app.symbol)} · C ${fmtPrice(last?.close, app.symbol)}</span>
      <span>${data.candles.length} bougies</span>`;
  }
}

/* ------------------------------------------------------------------ trading */
async function renderTrading() {
  const state = app.state;
  renderPositionsTable($("#table-open-positions"), state.positions);

  const orders = state.orders || [];
  const body = $("#table-orders tbody");
  body.innerHTML = orders.length
    ? orders
        .slice(0, 25)
        .map(
          (order) => `<tr>
            <td class="mono">${clock(order.created_at)}</td>
            <td>${escapeHtml(order.symbol)}</td>
            <td><span class="tag ${order.side === "BUY" ? "buy" : "sell"}">${order.side}</span></td>
            <td class="num">${num(order.qty, 4)}</td>
            <td class="num">${num(order.filled_qty, 4)}</td>
            <td><span class="tag ${orderStateClass(order.state)}">${escapeHtml(order.state)}</span></td>
            <td>${["CREATED", "SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.state)
              ? `<button class="btn btn-ghost" data-cancel="${escapeHtml(order.id)}">Annuler</button>`
              : ""}</td>
          </tr>`
        )
        .join("")
    : `<tr class="empty"><td colspan="7">Aucun ordre.</td></tr>`;
  body.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api.cancelOrder(button.dataset.cancel);
        toast("Annulation demandée", "La plateforme confirme l'annulation avant mise à jour.", "ok");
        await refreshState();
      } catch (error) {
        toast("Annulation impossible", error.message, "bad");
      }
    });
  });

  try {
    const history = await api.positionsHistory(60);
    const rows = history.positions || [];
    const histBody = $("#table-history tbody");
    histBody.innerHTML = rows.length
      ? rows
          .map(
            (position) => `<tr>
              <td class="mono">${dateTime(position.opened_at)}</td>
              <td class="mono">${dateTime(position.closed_at)}</td>
              <td>${escapeHtml(position.symbol)}</td>
              <td><span class="tag ${position.side === "BUY" ? "buy" : "sell"}">${position.side}</span></td>
              <td class="num">${num(position.qty, 4)}</td>
              <td class="num">${fmtPrice(position.entry_price, position.symbol)}</td>
              <td class="num">${fmtPrice(position.close_price, position.symbol)}</td>
              <td class="num ${Number(position.realized_pnl) >= 0 ? "pos" : "neg"}">${signed(position.realized_pnl, 2)}</td>
              <td class="num">${num(position.fees, 2)}</td>
              <td><span class="tag">${escapeHtml(position.close_reason || "—")}</span></td>
            </tr>`
          )
          .join("")
      : `<tr class="empty"><td colspan="10">Aucune transaction clôturée.</td></tr>`;
  } catch {
    /* l'historique sera retenté au prochain cycle */
  }
}

function orderStateClass(state) {
  if (["FILLED", "ACCEPTED"].includes(state)) return "ok";
  if (["REJECTED", "CANCELLED", "EXPIRED"].includes(state)) return "bad";
  if (["UNKNOWN", "CANCEL_PENDING"].includes(state)) return "warn";
  return "info";
}

/* ------------------------------------------------------------------ strategies */
function renderStrategies() {
  const host = $("#strategy-list");
  if (!host) return;
  host.innerHTML = app.strategies
    .map(
      (strategy) => `<article class="strategy">
        <header>
          <div>
            <h4>${escapeHtml(strategy.label)}</h4>
            <span class="tag info">${escapeHtml(strategy.key)}</span>
            <span class="tag">${escapeHtml(strategy.timeframe)}</span>
          </div>
          <label class="switch">
            <input type="checkbox" data-strategy="${escapeHtml(strategy.key)}" ${strategy.enabled ? "checked" : ""} />
            <span></span>
          </label>
        </header>
        <p>${escapeHtml(strategy.description)}</p>
        <div class="params">${Object.entries(strategy.params)
          .map(([key, value]) => `<code>${escapeHtml(key)}=${escapeHtml(String(value))}</code>`)
          .join("")}</div>
      </article>`
    )
    .join("");
  host.querySelectorAll("[data-strategy]").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        await api.toggleStrategy(input.dataset.strategy, input.checked);
        toast("Stratégie mise à jour", `${input.dataset.strategy} ${input.checked ? "activée" : "désactivée"}`, "ok");
        await refreshStrategies();
        renderStrategies();
      } catch (error) {
        input.checked = !input.checked;
        toast("Modification refusée", error.message, "bad");
      }
    });
  });
}

async function runBacktest(event) {
  event.preventDefault();
  const button = $("#bt-submit");
  const symbols = Array.from($("#bt-symbols").selectedOptions).map((option) => option.value);
  setError("#bt-error", "");
  if (!symbols.length) {
    setError("#bt-error", "Sélectionnez au moins un instrument.");
    return;
  }
  button.disabled = true;
  button.textContent = "Simulation en cours…";
  try {
    const result = await api.backtest({
      strategy: $("#bt-strategy").value,
      symbols,
      timeframe: $("#bt-timeframe").value,
      bars: Number($("#bt-bars").value) || 800,
      risk_per_trade_pct: Number($("#bt-risk").value) || 0.5,
      walk_forward_windows: Number($("#bt-wf").value) || 3,
      monte_carlo_runs: Number($("#bt-mc").value) || 1000,
      name: `${$("#bt-strategy").value} · ${symbols.join(", ")}`,
    });
    app.backtest = result;
    renderBacktest(result);
    toast("Backtest terminé", `${result.metrics.trades} transactions simulées`, "ok");
  } catch (error) {
    setError("#bt-error", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Lancer la simulation";
  }
}

function renderBacktest(result) {
  const metrics = result.metrics;
  $("#bt-results").classList.remove("hidden");
  $("#bt-stamp").textContent = `${result.name} · ${dateTime(result.generated_at)}`;
  const kpis = [
    ["Transactions", num(metrics.trades, 0)],
    ["Win rate", `${num(metrics.win_rate, 1)} %`],
    ["Profit factor", num(metrics.profit_factor, 2)],
    ["P&L net", signed(metrics.net_pnl, 2)],
    ["Max drawdown", `${num(metrics.max_drawdown_pct, 2)} %`],
    ["Sharpe", num(metrics.sharpe, 2)],
    ["Sortino", num(metrics.sortino, 2)],
    ["Expectancy", signed(metrics.expectancy, 2)],
    ["Recovery", num(metrics.recovery_factor, 2)],
    ["Frais", money(metrics.fees)],
  ];
  $("#bt-kpis").innerHTML = kpis
    .map(([label, value]) => `<article class="card kpi"><header>${escapeHtml(label)}</header>
      <strong class="kpi-value mono">${value}</strong></article>`)
    .join("");

  drawEquityChart($("#chart-backtest"), metrics.equity_curve || [], {
    height: 220,
    baseline: Number(result.config.initial_capital),
  });

  const mc = metrics.monte_carlo || {};
  const wf = metrics.walk_forward || {};
  const bench = metrics.benchmark || {};
  const rows = [
    ["Monte-Carlo — médiane", mc.median_final_equity !== undefined ? money(mc.median_final_equity) : "—"],
    ["Monte-Carlo — P05", mc.p05_final_equity !== undefined ? money(mc.p05_final_equity) : "—"],
    ["Drawdown P95 simulé", mc.p95_drawdown_pct !== undefined ? `${num(mc.p95_drawdown_pct, 1)} %` : "—"],
    ["Probabilité de gain", mc.probability_of_profit !== undefined ? `${num(mc.probability_of_profit, 1)} %` : "—"],
    ["Fenêtres positives", `${wf.windows_positive ?? 0} / ${wf.windows_total ?? 0}`],
    ["Stabilité", wf.stable ? "stable" : "fragile"],
    ["Référence passive", bench.return_pct !== undefined ? `${num(bench.return_pct, 2)} % (${bench.symbol})` : "—"],
  ];
  $("#bt-robustness").innerHTML = rows
    .map(([label, value]) => `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join("");

  $("#table-wf tbody").innerHTML = (wf.windows || [])
    .map(
      (window) => `<tr>
        <td>${window.window}</td>
        <td class="num">${window.trades ?? "—"}</td>
        <td class="num">${window.win_rate !== undefined ? `${num(window.win_rate, 1)} %` : "—"}</td>
        <td class="num ${Number(window.net_pnl) >= 0 ? "pos" : "neg"}">${window.net_pnl !== undefined ? signed(window.net_pnl, 2) : "—"}</td>
        <td class="num">${window.max_drawdown_pct !== undefined ? `${num(window.max_drawdown_pct, 2)} %` : "—"}</td>
      </tr>`
    )
    .join("");

  $("#table-bt-trades tbody").innerHTML = (result.trades || []).length
    ? result.trades
        .slice()
        .reverse()
        .map(
          (trade) => `<tr>
            <td class="mono">${dateTime(trade.entry_time)}</td>
            <td class="mono">${dateTime(trade.exit_time)}</td>
            <td>${escapeHtml(trade.symbol)}</td>
            <td><span class="tag ${trade.side === "BUY" ? "buy" : "sell"}">${trade.side}</span></td>
            <td class="num ${Number(trade.pnl) >= 0 ? "pos" : "neg"}">${signed(trade.pnl, 2)}</td>
            <td><span class="tag">${escapeHtml(trade.reason)}</span></td>
          </tr>`
        )
        .join("")
    : `<tr class="empty"><td colspan="6">Aucune transaction sur cette période.</td></tr>`;
}

/* ------------------------------------------------------------------ risk */
async function renderRisk() {
  const state = app.state;
  const policy = state.risk.policy;
  $("#policy-grid").innerHTML = Object.entries(policy)
    .map(([key, value]) => `<div class="kv"><span>${escapeHtml(key)}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join("");

  const decisions = (state.signals || []).slice(0, 12);
  $("#decision-list").innerHTML = decisions.length
    ? decisions
        .map((signal) => {
          const allowed = signal.allowed === 1 || signal.allowed === true;
          return `<div class="feed-item ${allowed ? "ok" : "bad"}">
            <span class="tag ${signal.side === "BUY" ? "buy" : "sell"}">${signal.side}</span>
            <div class="feed-main">
              <strong>${escapeHtml(signal.symbol)} · ${escapeHtml(signal.strategy)}</strong>
              <small>${escapeHtml((signal.decision_reasons || [])[0] || "décision en attente")}</small>
            </div>
            <div class="feed-meta"><span class="tag ${allowed ? "ok" : "warn"}">${escapeHtml(signal.code || "—")}</span><br>
            <small>${timeAgo(signal.created_at)}</small></div>
          </div>`;
        })
        .join("")
    : `<p class="muted small">Aucune décision enregistrée pour l'instant.</p>`;

  const guard = state.environment;
  const lines = [
    ...(guard.blockers || []).map((blocker) => `<div class="guard-line blocked"><span class="mark">✕</span><span>${escapeHtml(blocker)}</span></div>`),
    `<div class="guard-line ok"><span class="mark">✓</span><span>Connecteur actif : ${escapeHtml(
      state.connectors?.[1]?.connector || state.connectors?.[0]?.name || "simulation"
    )} (aucun ordre réel possible)</span></div>`,
  ];
  $("#guard-box").innerHTML = lines.join("");

  try {
    const validations = await api.validations();
    $("#validations").innerHTML = Object.values(validations.validations || {})
      .map(
        (validation) => `<div class="validation">
          <span class="tag ${validation.closed ? "ok" : "bad"}">${validation.closed ? "close" : "ouverte"}</span>
          <div class="grow">
            <strong>${escapeHtml(validation.label)}</strong>
            <small>${validation.closed ? escapeHtml(validation.evidence) : "Preuve documentée requise (section 24)"}</small>
          </div>
          ${app.user?.role === "ADMIN" ? `<button class="btn btn-ghost" data-validation="${escapeHtml(validation.key)}">${validation.closed ? "Rouvrir" : "Clore"}</button>` : ""}
        </div>`
      )
      .join("");
    $("#validations").querySelectorAll("[data-validation]").forEach((button) => {
      button.addEventListener("click", async () => {
        const key = button.dataset.validation;
        const current = validations.validations[key];
        const closing = !current.closed;
        let evidence = current.evidence;
        if (closing) {
          evidence = window.prompt("Preuve documentée (référence de test, rapport, date) :", "") || "";
          if (!evidence.trim()) {
            toast("Preuve requise", "Une validation ne peut être close sans preuve.", "bad");
            return;
          }
        }
        try {
          await api.recordValidation({ key, closed: closing, evidence, note: "" });
          toast("Validation enregistrée", key, "ok");
          await renderRisk();
        } catch (error) {
          toast("Refusé", error.message, "bad");
        }
      });
    });
  } catch {
    $("#validations").innerHTML = `<p class="muted small">Validations indisponibles.</p>`;
  }

  const exposures = {};
  (state.positions || []).forEach((position) => {
    const spec = app.symbols.find((s) => s.symbol === position.symbol);
    const group = spec?.correlation_group || "AUTRE";
    exposures[group] = (exposures[group] || 0) + Math.abs(Number(position.qty) * Number(position.entry_price));
  });
  const total = Object.values(exposures).reduce((sum, value) => sum + value, 0) || 1;
  $("#exposure").innerHTML = Object.keys(exposures).length
    ? Object.entries(exposures)
        .map(
          ([group, value]) => `<div class="exposure-row">
            <span>${escapeHtml(group)}</span>
            <div class="bar"><i style="width:${((value / total) * 100).toFixed(1)}%"></i></div>
            <span class="mono">${money(value, state.account.currency, 0)}</span>
          </div>`
        )
        .join("")
    : `<p class="muted small">Aucune exposition : pas de position ouverte.</p>`;
}

async function submitPolicy(event) {
  event.preventDefault();
  setError("#policy-error", "");
  const field = $("#policy-field").value;
  const value = $("#policy-value").value.trim();
  if (!field || !value) {
    setError("#policy-error", "Paramètre et valeur requis.");
    return;
  }
  if (!(await confirmAction({
    title: "Modifier la politique de risque",
    text: "Cette action est réservée au propriétaire et sera journalisée. Confirmez-vous la modification ?",
    requireText: "MODIFIER",
  }))) return;
  try {
    const result = await api.policyUpdate({
      changes: { [field]: value },
      reason: $("#policy-reason").value || "modification propriétaire",
      owner_token: $("#policy-token").value,
      confirmation: $("#policy-phrase").value,
    });
    toast("Politique mise à jour", `version ${result.policy.version}`, "ok");
    $("#policy-form").reset();
    await refreshState();
  } catch (error) {
    setError("#policy-error", error.message);
  }
}

/* ------------------------------------------------------------------ journal */
async function refreshJournal() {
  const params = { limit: 300 };
  if (app.journal.level) params.level = app.journal.level;
  try {
    const data = await api.journal(params);
    app.journal.entries = data.entries || [];
    renderJournal();
  } catch {
    /* sera retenté */
  }
}

function renderJournal() {
  const state = app.state;
  const diag = state;
  const cards = [
    ["Service", `${state.app.state}`, `${state.app.tick_count} cycles · ${num(state.app.uptime_seconds, 0)} s`],
    ["Base de données", state.journal.total ? `${state.journal.total} événements` : "—", "SQLite WAL · intégrité vérifiée"],
    ["Réconciliation", state.reconciliation?.status || "—", `${num(state.reconciliation?.duration_ms, 1)} ms`],
    ["Journal", `${state.journal.by_level?.CRITICAL || 0} critiques`, `${state.journal.by_level?.WARNING || 0} avertissements`],
  ];
  $("#diag-cards").innerHTML = cards
    .map(([title, value, detail]) => `<article class="card kpi"><header>${escapeHtml(title)}</header>
      <strong class="kpi-value mono">${escapeHtml(value)}</strong><footer>${escapeHtml(detail)}</footer></article>`)
    .join("");

  const search = app.journal.search.toLowerCase();
  const entries = app.journal.entries.filter(
    (entry) =>
      !search ||
      `${entry.event} ${entry.module} ${entry.message}`.toLowerCase().includes(search)
  );
  const host = $("#log-list");
  host.innerHTML = entries.length
    ? entries
        .map(
          (entry) => `<div class="log-row ${escapeHtml(entry.level)}">
            <span class="time">${dateTime(entry.created_at)}</span>
            <span class="lvl" style="color:${levelColor(entry.level)}">${escapeHtml(entry.level)}</span>
            <span class="msg"><strong>${escapeHtml(entry.event)}</strong> — ${escapeHtml(entry.message)}
            <small>${escapeHtml(entry.module)}</small></span>
          </div>`
        )
        .join("")
    : `<p class="muted small">Aucun événement pour ce filtre.</p>`;

  api
    .reconciliations()
    .then((data) => {
      $("#table-recon tbody").innerHTML = (data.reconciliations || [])
        .map(
          (recon) => `<tr>
            <td class="mono">${dateTime(recon.created_at)}</td>
            <td><span class="tag ${recon.status === "OK" ? "ok" : "warn"}">${escapeHtml(recon.status)}</span></td>
            <td class="num">${num(recon.duration_ms, 1)}</td>
            <td><small class="muted">${escapeHtml(
              `${recon.details?.positions_local ?? 0} positions locales · ${recon.details?.positions_platform ?? 0} plateforme`
            )}</small></td>
          </tr>`
        )
        .join("") || `<tr class="empty"><td colspan="4">Aucune réconciliation.</td></tr>`;
    })
    .catch(() => {});

  api
    .backups()
    .then((data) => {
      $("#table-backups tbody").innerHTML = (data.backups || []).length
        ? data.backups
            .map(
              (backup) => `<tr>
                <td class="mono">${escapeHtml(backup.name)}</td>
                <td class="num">${num(backup.size_bytes / 1024, 0)} Ko</td>
                <td><span class="tag ${backup.encrypted ? "ok" : "warn"}">${backup.encrypted ? "oui" : "non"}</span></td>
                <td><button class="btn btn-ghost" data-verify="${escapeHtml(backup.path)}">Vérifier</button></td>
              </tr>`
            )
            .join("")
        : `<tr class="empty"><td colspan="4">Aucune sauvegarde encore créée.</td></tr>`;
      $("#table-backups").querySelectorAll("[data-verify]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            const result = await api.verifyBackup(button.dataset.verify);
            toast("Sauvegarde intègre", `${result.journal_rows} entrées de journal vérifiées`, "ok");
          } catch (error) {
            toast("Vérification échouée", error.message, "bad");
          }
        });
      });
    })
    .catch(() => {});
}

function levelColor(level) {
  return { CRITICAL: "#ff707d", ERROR: "#ff707d", WARNING: "#ffc65c", INFO: "#93a6bf", DEBUG: "#6b7f99" }[level] || "#93a6bf";
}

/* ------------------------------------------------------------------ settings */
function renderConnections(state) {
  const grid = $("#connections-grid");
  const isAdmin = app.user?.role === "ADMIN";
  if (grid) grid.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;

  const mt5 = state.mt5_connection || {};
  $("#mt5-badge").textContent = mt5.enabled ? "activée" : "non configurée";
  if (!$("#mt5-url").matches(":focus")) $("#mt5-url").value = mt5.bridge_url || "";
  $("#mt5-broker").value = mt5.broker || "";
  $("#mt5-server").value = mt5.server || "";
  $("#mt5-login").value = mt5.login || "";
  $("#mt5-suffix").value = mt5.symbol_suffix || "";
  $("#mt5-symbol-map").value = Object.entries(mt5.symbol_map || {})
    .map(([key, value]) => `${key}=${value}`).join(", ");
  $("#mt5-enabled").checked = Boolean(mt5.enabled);
  $("#mt5-orders").checked = Boolean(mt5.allow_demo_orders);
  const live = (state.connectors || []).find((entry) => entry && entry.kind === "mt5");
  const last = mt5.last_test;
  const bits = [
    mt5.has_token ? "jeton enregistré" : "jeton absent",
    mt5.bridge_url_masked ? `pont ${mt5.bridge_url_masked}` : "pont non configuré",
    live ? "pont chargé par le moteur" : "moteur en simulation",
    mt5.orders_notice,
  ];
  if (last) {
    bits.push(`dernier test ${last.ok ? "réussi" : "échoué"} ${timeAgo(last.at)}`
      + (last.detail ? ` — ${last.detail}` : ""));
  }
  $("#mt5-status").textContent = bits.join(" · ");

  const alerts = state.alerts || {};
  $("#alerts-badge").textContent = alerts.enabled
    ? `actif (${alerts.resolved_format || "auto"})`
    : (alerts.configured ? "configuré, désactivé" : "non configuré");
  if (!$("#alert-url").matches(":focus")) $("#alert-url").value = alerts.url_masked || "";
  $("#alert-format").value = alerts.format || "auto";
  $("#alert-level").value = alerts.min_level || "WARNING";
  $("#alert-enabled").checked = Boolean(alerts.enabled);
  const alertBits = [
    alerts.url_masked ? `cible ${alerts.url_masked}` : "aucune cible",
    `format ${alerts.resolved_format || alerts.format || "auto"}`,
    `niveau ≥ ${alerts.min_level || "WARNING"}`,
    `${alerts.sent || 0} envoyée(s)`,
    `${alerts.failures || 0} échec(s)`,
  ];
  if (alerts.last_result) {
    alertBits.push(`dernier envoi ${alerts.last_result.ok ? "réussi" : "échoué"} `
      + `${timeAgo(alerts.last_result.at)}`);
  }
  $("#alerts-status").textContent = alertBits.join(" · ");
}

function parseSymbolMap(text) {
  const map = {};
  String(text || "")
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [rawKey, ...rest] = entry.split(/[=:]/);
      const key = (rawKey || "").trim().toUpperCase();
      const value = rest.join("=").trim();
      if (key && value) map[key] = value;
    });
  return map;
}

async function onSaveMt5(event) {
  event.preventDefault();
  const error = $("#mt5-error");
  error.textContent = "";
  const payload = {
    bridge_url: $("#mt5-url").value.trim(),
    bridge_token: $("#mt5-token").value.trim(),
    broker: $("#mt5-broker").value.trim(),
    server: $("#mt5-server").value.trim(),
    login: $("#mt5-login").value.trim(),
    symbol_suffix: $("#mt5-suffix").value.trim(),
    symbol_map: parseSymbolMap($("#mt5-symbol-map").value),
    enabled: $("#mt5-enabled").checked,
    allow_demo_orders: $("#mt5-orders").checked,
  };
  if (!payload.bridge_token) delete payload.bridge_token;
  try {
    const result = await api.saveMt5(payload);
    $("#mt5-token").value = "";
    toast("Connexion MT5 enregistrée", result.message || "", "ok");
    await refreshState();
  } catch (err) {
    error.textContent = err.message;
    toast("Enregistrement refusé", err.message, "bad");
  }
}

async function onTestMt5() {
  const error = $("#mt5-error");
  error.textContent = "";
  const payload = {};
  if ($("#mt5-url").value.trim()) payload.bridge_url = $("#mt5-url").value.trim();
  if ($("#mt5-token").value.trim()) payload.bridge_token = $("#mt5-token").value.trim();
  if ($("#mt5-suffix").value.trim()) payload.symbol_suffix = $("#mt5-suffix").value.trim();
  const symbolMap = parseSymbolMap($("#mt5-symbol-map").value);
  if (Object.keys(symbolMap).length) payload.symbol_map = symbolMap;
  try {
    const { result } = await api.testMt5(payload);
    const symbols = result.symbols || {};
    if (symbols.checked) {
      const matched = (symbols.matched || [])
        .map((row) => `${row.canonical} → ${row.platform}`).join(", ") || "aucun";
      const missing = (symbols.missing || []).join(", ") || "aucun";
      const sample = (symbols.available_sample || []).join(", ") || "—";
      $("#mt5-instruments").textContent =
        `Reconnus : ${matched}\nManquants : ${missing}\n`
        + `Disponibles (${symbols.available_count || 0}) : ${sample}`;
      $("#mt5-instruments-box").open = true;
    }
    if (result.ok) {
      const symbols = result.symbols || {};
      const missing = symbols.missing || [];
      const instruments = missing.length
        ? ` · instruments non reconnus : ${missing.join(", ")}`
        : ` · ${(symbols.matched || []).length}/${(symbols.checked || []).length} instruments reconnus`;
      toast("Pont MT5 joignable",
        `compte ${result.account?.account_id || "—"} · ${result.quotes_received} cotation(s) · `
        + `${result.orders_enabled ? "ordres démo actifs" : "ordres désactivés"}${instruments}`, "ok");
    } else {
      toast("Test MT5 échoué", `${result.code || ""} ${result.detail || ""}`.trim(), "bad");
    }
    await refreshState();
  } catch (err) {
    error.textContent = err.message;
    toast("Test impossible", err.message, "bad");
  }
}

async function onDisableMt5() {
  const confirmed = await confirmAction({
    title: "Désactiver le pont MT5",
    text: "Les nouvelles entrées seront bloquées au prochain redémarrage ; la simulation "
      + "reste disponible. Les ordres démo seront désarmés.",
    confirmLabel: "Désactiver",
  });
  if (!confirmed) return;
  try {
    await api.disableMt5();
    toast("Pont MT5 désactivé", "Redémarrez le service pour revenir à la simulation.", "ok");
    await refreshState();
  } catch (err) {
    toast("Désactivation impossible", err.message, "bad");
  }
}

async function onSaveAlerts(event) {
  event.preventDefault();
  const error = $("#alerts-error");
  error.textContent = "";
  const payload = {
    format: $("#alert-format").value,
    min_level: $("#alert-level").value,
    enabled: $("#alert-enabled").checked,
  };
  const url = $("#alert-url").value.trim();
  if (url) payload.url = url;
  try {
    const result = await api.saveAlerts(payload);
    if (!result.alerts?.configured) throw new ApiError("Renseignez une URL de webhook.", 400);
    toast("Canal d'alerte enregistré",
      result.alerts.enabled ? "Les alertes critiques seront envoyées." : "Canal désactivé.", "ok");
    await refreshState();
  } catch (err) {
    error.textContent = err.message;
    toast("Enregistrement refusé", err.message, "bad");
  }
}

async function onTestAlerts() {
  const error = $("#alerts-error");
  error.textContent = "";
  try {
    const { result } = await api.testAlerts();
    if (result.ok) {
      toast("Alerte de test envoyée", `HTTP ${result.status} en ${result.attempts} tentative(s).`, "ok");
    } else {
      toast("Envoi impossible", result.error || "Vérifiez l'URL du webhook.", "bad");
    }
    await refreshState();
  } catch (err) {
    error.textContent = err.message;
    toast("Test impossible", err.message, "bad");
  }
}

async function onDisableAlerts() {
  const confirmed = await confirmAction({
    title: "Désactiver le canal d'alerte",
    text: "Plus aucune notification ne sera envoyée à l'extérieur. Les alertes restent "
      + "visibles dans l'application.",
    confirmLabel: "Désactiver",
  });
  if (!confirmed) return;
  try {
    await api.disableAlerts();
    toast("Canal d'alerte désactivé", "", "ok");
    await refreshState();
  } catch (err) {
    toast("Désactivation impossible", err.message, "bad");
  }
}

async function renderSettings() {
  const state = app.state;
  $("#settings-role").textContent = app.user?.role || "—";
  $("#account-grid").innerHTML = [
    ["Identifiant", app.user?.username || "—"],
    ["Rôle", app.user?.role || "—"],
    ["MFA", app.user?.totp_enabled ? "activée" : "désactivée"],
    ["Environnement", state.environment.environment],
    ["Compte", state.account.account_id],
    ["Devise", state.account.currency],
    ["Capital initial", money(state.performance.initial_capital, state.account.currency)],
    ["Horloge simulée", `${num(state.simulation?.speed ?? 1, 0)}×`],
  ]
    .map(([label, value]) => `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join("");

  $("#about-version").textContent = `v${state.app.version}`;
  $("#about-box").innerHTML = `
    <p><strong>Carnet de Trading</strong> — plateforme de suivi, d'analyse et d'exécution contrôlée.</p>
    <p>Environnement ${escapeHtml(state.environment.environment)} : aucun ordre réel n'est transmis. Les données de marché proviennent d'un générateur déterministe.</p>
    <p>Moteur de risque v${state.risk.policy.version} · ${state.strategies.length} stratégies · ${state.market.length} instruments.</p>
    <p>Les décisions réservées au propriétaire (mode réel, politique de risque, mise en production) restent bloquées par construction.</p>`;

  try {
    const sessions = await api.sessions();
    $("#session-list").innerHTML = (sessions.sessions || [])
      .map(
        (session) => `<div class="feed-item">
          <span class="tag info">${escapeHtml(session.ip || "—")}</span>
          <div class="feed-main"><strong>${escapeHtml(session.username)}</strong>
          <small>${escapeHtml((session.user_agent || "").slice(0, 48))}</small></div>
          <div class="feed-meta"><small>${timeAgo(session.created_at)}</small>
          <button class="btn btn-ghost" data-session="${escapeHtml(session.id)}">Révoquer</button></div>
        </div>`
      )
      .join("") || `<p class="muted small">Aucune session active.</p>`;
    $("#session-list").querySelectorAll("[data-session]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api.revokeSession(button.dataset.session).catch(() => {});
        renderSettings();
      });
    });
  } catch {
    $("#session-list").innerHTML = `<p class="muted small">Sessions indisponibles.</p>`;
  }

  const connectors = state.connectors || [];
  const descriptor = connectors.find((entry) => entry && entry.kind) || {};
  const mt5Config = state.mt5_connection || {};
  const bridgeActive = descriptor.kind === "mt5";
  const bridgeOnline = bridgeActive && descriptor.connected !== false;
  const platforms = [
    {
      name: "MetaTrader 5 (démo) — pont",
      status: bridgeActive
        ? (bridgeOnline ? "pont actif" : "pont hors ligne")
        : (mt5Config.enabled ? "configuré — redémarrage requis" : "non configuré"),
      detail: bridgeActive
        ? `Cotations du terminal ${escapeHtml(descriptor.name || "MT5")} ; `
          + `${mt5Config.allow_demo_orders ? "ordres démo autorisés (bracket obligatoire)" : "ordres désactivés"}. `
          + "Aucun compte réel n'est accepté."
        : "Terminal MT5 démo sur nœud Windows isolé, joint par l'agent à jeton partagé "
          + "(section 9). Le passage d'ordre reste désactivé tant qu'il n'est pas coché.",
      ok: bridgeOnline,
    },
    {
      name: "Exchange crypto Spot",
      status: "non sélectionné",
      detail: "API officielle, clés à permissions limitées, retraits désactivés, Spot uniquement (section 10).",
      ok: false,
    },
    {
      name: "Simulation interne",
      status: bridgeActive ? "en veille (pont actif)" : "actif",
      detail: "Marché synthétique déterministe, exécution et protections hébergées reproduites "
        + "fidèlement. Aucun ordre ne quitte le serveur.",
      ok: !bridgeActive,
    },
  ];
  $("#platforms").innerHTML = platforms
    .map(
      (platform) => `<div class="validation">
        <span class="tag ${platform.ok ? "ok" : "warn"}">${platform.ok ? "actif" : "bloqué"}</span>
        <div class="grow"><strong>${escapeHtml(platform.name)}</strong>
        <small>${escapeHtml(platform.detail)}</small></div>
        <span class="tag">${escapeHtml(platform.status)}</span>
      </div>`
    )
    .join("");

  renderConnections(state);

  const usersCard = $("#users-card");
  if (app.user?.role !== "ADMIN") {
    usersCard.classList.add("hidden");
    return;
  }
  usersCard.classList.remove("hidden");
  try {
    const data = await api.users();
    const counts = {};
    (data.sessions || []).forEach((session) => {
      counts[session.username] = (counts[session.username] || 0) + 1;
    });
    $("#table-users tbody").innerHTML = (data.users || [])
      .map(
        (user) => `<tr>
          <td>${escapeHtml(user.username)}</td>
          <td><span class="tag info">${escapeHtml(user.role)}</span></td>
          <td>${user.totp_enabled ? "activée" : "—"}</td>
          <td class="num">${counts[user.username] || 0}</td>
          <td>—</td>
        </tr>`
      )
      .join("");
  } catch {
    /* ignoré */
  }
}

/* ------------------------------------------------------------------ actions */
async function onStopTrading() {
  if (!(await confirmAction({
    title: "Arrêt trading",
    text: "Les nouvelles entrées seront bloquées et les ordres d'entrée en attente annulés. Les stops et objectifs des positions ouvertes restent actifs.",
    requireText: "ARRETER",
    confirmLabel: "Arrêter les entrées",
  }))) return;
  try {
    const result = await api.stopTrading("arrêt manuel depuis le terminal");
    toast("Entrées bloquées", `${(result.cancelled_orders || []).length} ordre(s) annulé(s)`, "ok");
    await refreshState();
  } catch (error) {
    toast("Action refusée", error.message, "bad");
  }
}

async function onLiquidate() {
  if (!(await confirmAction({
    title: "Liquidation d'urgence",
    text: "Toutes les positions seront fermées et l'état vérifié auprès de la plateforme. Cette action est journalisée en niveau CRITIQUE.",
    requireText: "LIQUIDER",
    confirmLabel: "Liquider",
  }))) return;
  try {
    const result = await api.liquidate("LIQUIDER", "liquidation manuelle depuis le terminal");
    if (result.positions_open) {
      toast("Liquidation incomplète", `${result.positions_open} position(s) encore ouverte(s)`, "bad");
    } else {
      toast("Liquidation confirmée", `${(result.closed || []).length} position(s) fermée(s)`, "ok");
    }
    await refreshState();
  } catch (error) {
    toast("Liquidation refusée", error.message, "bad");
  }
}

async function onReconcile() {
  try {
    const result = await api.reconcile();
    toast("Réconciliation terminée", result.status, result.status === "OK" ? "ok" : "bad");
    await refreshState();
    if (app.view === "journal") renderJournal();
  } catch (error) {
    toast("Réconciliation impossible", error.message, "bad");
  }
}

async function onVerifyJournal() {
  try {
    const result = await api.verifyJournal();
    if (result.ok) {
      toast("Journal intègre", `${result.checked} entrées vérifiées`, "ok");
    } else {
      toast("Rupture détectée", `entrée ${result.broken_at}`, "bad");
    }
    if (app.view === "journal") refreshJournal();
  } catch (error) {
    toast("Vérification impossible", error.message, "bad");
  }
}

async function onBackup() {
  try {
    const result = await api.createBackup("manual");
    toast("Sauvegarde créée", `${num(result.backup.size_bytes / 1024, 0)} Ko`, "ok");
    if (app.view === "journal") refreshJournal();
  } catch (error) {
    toast("Sauvegarde échouée", error.message, "bad");
  }
}

async function onDrill() {
  try {
    const result = await api.drillBackup();
    toast("Restauration testée", `${num(result.restored_bytes / 1024, 0)} Ko restaurés`, "ok");
  } catch (error) {
    toast("Exercice échoué", error.message, "bad");
  }
}

async function onChangePassword(event) {
  event.preventDefault();
  setError("#pwd-error", "");
  try {
    const result = await api.changePassword($("#pwd-current").value, $("#pwd-new").value, $("#pwd-code").value || undefined);
    api.setToken(result.token);
    toast("Mot de passe mis à jour", "Toutes les autres sessions ont été révoquées.", "ok");
    $("#password-form").reset();
  } catch (error) {
    setError("#pwd-error", error.message);
  }
}

async function onMfaSetup() {
  try {
    const data = await api.totpSetup();
    app.mfaSecret = data.secret;
    $("#mfa-setup").classList.remove("hidden");
    $("#mfa-secret").textContent = data.secret;
    $("#mfa-error").textContent = "";
  } catch (error) {
    setError("#mfa-error", error.message);
  }
}

async function onMfaEnable() {
  try {
    await api.totpEnable(app.mfaSecret, $("#mfa-code").value.trim());
    toast("MFA activée", "Le code sera demandé à la connexion.", "ok");
    const me = await api.me();
    app.user = me.user;
    $("#mfa-setup").classList.add("hidden");
    renderSettings();
  } catch (error) {
    setError("#mfa-error", error.message);
  }
}

async function onCreateUser(event) {
  event.preventDefault();
  setError("#user-error", "");
  try {
    await api.createUser({
      username: $("#user-name-input").value.trim(),
      password: $("#user-password-input").value,
      role: $("#user-role-input").value,
    });
    toast("Utilisateur créé", "Changement de mot de passe imposé à la première connexion.", "ok");
    $("#user-form").reset();
    renderSettings();
  } catch (error) {
    setError("#user-error", error.message);
  }
}

async function openNotifications() {
  const drawer = $("#notification-drawer");
  const overlay = $("#overlay");
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  overlay.classList.remove("hidden");
  try {
    const data = await api.notifications();
    const items = data.notifications || [];
    $("#notification-list").innerHTML = items.length
      ? items
          .map(
            (notification) => `<div class="notif ${escapeHtml(notification.level)}">
              <strong>${escapeHtml(notification.title)}</strong>
              <span>${escapeHtml(notification.message)}</span><br>
              <small>${dateTime(notification.created_at)} · ${escapeHtml(notification.code)}</small>
            </div>`
          )
          .join("")
      : `<p class="muted small">Aucune alerte.</p>`;
  } catch (error) {
    $("#notification-list").innerHTML = `<p class="muted small">${escapeHtml(error.message)}</p>`;
  }
}

function closeDrawer() {
  $("#notification-drawer").classList.add("hidden");
  $("#notification-drawer").setAttribute("aria-hidden", "true");
  $("#overlay").classList.add("hidden");
}

async function markNotificationsRead() {
  await api.markNotificationsRead().catch(() => {});
  closeDrawer();
  await refreshState();
}

/* ------------------------------------------------------------------ events */
function bindEvents() {
  $("#login-form").addEventListener("submit", handleLogin);
  $("#btn-logout").addEventListener("click", logout);
  $("#menu-btn").addEventListener("click", () => {
    const sidebar = $("#sidebar");
    const open = sidebar.classList.toggle("open");
    $("#menu-btn").setAttribute("aria-expanded", String(open));
  });
  $("#user-chip").addEventListener("click", () => {
    $("#user-dropdown").classList.toggle("hidden");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".user-menu")) $("#user-dropdown").classList.add("hidden");
  });
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.nav)));
  $$("[data-nav]").forEach((item) => {
    if (!item.classList.contains("nav-item")) {
      item.addEventListener("click", () => {
        $("#user-dropdown").classList.add("hidden");
        navigate(item.dataset.nav);
      });
    }
  });
  $("#btn-refresh").addEventListener("click", () => refreshState().catch(() => {}));
  $("#btn-stop").addEventListener("click", onStopTrading);
  $("#btn-liquidate").addEventListener("click", onLiquidate);
  $("#btn-reconcile").addEventListener("click", onReconcile);
  $("#btn-verify-journal").addEventListener("click", onVerifyJournal);
  $("#btn-backup").addEventListener("click", onBackup);
  $("#btn-notifications").addEventListener("click", openNotifications);
  $("#btn-close-drawer").addEventListener("click", closeDrawer);
  $("#overlay").addEventListener("click", closeDrawer);
  $("#btn-mark-read").addEventListener("click", markNotificationsRead);
  $("#tf-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tf]");
    if (!button) return;
    app.timeframe = button.dataset.tf;
    $$("#tf-switch button").forEach((node) => node.classList.toggle("active", node === button));
    loadCandles().catch((error) => toast("Graphique indisponible", error.message, "bad"));
  });
  $("#backtest-form").addEventListener("submit", runBacktest);
  $("#policy-form").addEventListener("submit", submitPolicy);
  $("#password-form").addEventListener("submit", onChangePassword);
  $("#btn-mfa-setup").addEventListener("click", onMfaSetup);
  $("#btn-mfa-enable").addEventListener("click", onMfaEnable);
  $("#user-form").addEventListener("submit", onCreateUser);
  $("#mt5-form").addEventListener("submit", onSaveMt5);
  $("#btn-mt5-test").addEventListener("click", onTestMt5);
  $("#btn-mt5-disable").addEventListener("click", onDisableMt5);
  $("#alerts-form").addEventListener("submit", onSaveAlerts);
  $("#btn-alert-test").addEventListener("click", onTestAlerts);
  $("#btn-alert-disable").addEventListener("click", onDisableAlerts);
  $("#journal-level").addEventListener("change", (event) => {
    app.journal.level = event.target.value;
    refreshJournal().catch(() => {});
  });
  $("#journal-search").addEventListener("input", (event) => {
    app.journal.search = event.target.value;
    renderJournal();
  });
  window.addEventListener("carnet:unauthorized", () => {
    toast("Session expirée", "Merci de vous reconnecter.", "bad");
    logout();
  });
  window.addEventListener("resize", () => {
    if (app.state) renderCurrentView();
    if (app.view === "markets") loadCandles().catch(() => {});
  });
  window.addEventListener("hashchange", () => {
    const view = window.location.hash.replace("#", "");
    if (view && view !== app.view) navigate(view);
  });
}

/* ------------------------------------------------------------------ démarrage */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installation PWA optionnelle : l'application reste pleinement fonctionnelle */
    });
  });
}

bindEvents();
boot();

// Rafraîchissement du graphique de marché quand la vue Marchés est active.
setInterval(() => {
  if (app.view === "markets" && !document.hidden) loadCandles().catch(() => {});
}, POLL_MARKET_MS);
