/**
 * Client HTTP de l'API Carnet de Trading.
 * Le jeton de session est conservé en sessionStorage (jamais en cookie) :
 * le serveur n'accepte que l'en-tête Authorization, ce qui neutralise le CSRF.
 */

const TOKEN_KEY = "carnet.token";

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const api = {
  token: null,

  loadToken() {
    try {
      this.token = sessionStorage.getItem(TOKEN_KEY) || null;
    } catch {
      this.token = null;
    }
    return this.token;
  },

  setToken(token) {
    this.token = token;
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* stockage indisponible : session en mémoire uniquement */
    }
  },

  clear() {
    this.token = null;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },

  async request(path, { method = "GET", body, signal } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        credentials: "same-origin",
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new ApiError(
        "Serveur injoignable. Vérifiez que le service tourne et que la connexion est stable.",
        0,
        "NETWORK"
      );
    }
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text.slice(0, 200) };
      }
    }
    if (!response.ok) {
      if (response.status === 401 && !path.includes("/auth/login")) {
        this.clear();
        window.dispatchEvent(new CustomEvent("carnet:unauthorized"));
      }
      throw new ApiError(payload.error || `Erreur ${response.status}`, response.status, payload.code);
    }
    return payload;
  },

  get(path, options) {
    return this.request(path, { ...options, method: "GET" });
  },

  post(path, body) {
    return this.request(path, { method: "POST", body: body || {} });
  },

  del(path) {
    return this.request(path, { method: "DELETE", body: {} });
  },

  // -- routes ---------------------------------------------------------------
  publicInfo: () => api.get("/api/public/info"),
  login: (username, password, code) => api.post("/api/auth/login", { username, password, code }),
  logout: () => api.post("/api/auth/logout", {}),
  me: () => api.get("/api/auth/me"),
  changePassword: (current_password, new_password, code) =>
    api.post("/api/auth/password", { current_password, new_password, code }),
  totpSetup: () => api.post("/api/auth/totp/setup", {}),
  totpEnable: (secret, code) => api.post("/api/auth/totp/enable", { secret, code }),
  totpDisable: (password, code) => api.post("/api/auth/totp/disable", { password, code }),

  state: () => api.get("/api/state"),
  health: () => api.get("/api/health"),
  symbols: () => api.get("/api/symbols"),
  candles: (symbol, tf = "15m", limit = 220) =>
    api.get(`/api/market/${encodeURIComponent(symbol)}/candles?tf=${tf}&limit=${limit}`),
  indicators: (symbol) => api.get(`/api/market/${encodeURIComponent(symbol)}/indicators`),

  orders: (limit = 100) => api.get(`/api/orders?limit=${limit}`),
  order: (id) => api.get(`/api/orders/${encodeURIComponent(id)}`),
  cancelOrder: (id) => api.post(`/api/orders/${encodeURIComponent(id)}/cancel`, {}),
  positions: () => api.get("/api/positions"),
  positionsHistory: (limit = 100) => api.get(`/api/positions/history?limit=${limit}`),
  signals: (limit = 50) => api.get(`/api/signals?limit=${limit}`),

  policy: () => api.get("/api/risk/policy"),
  policyUpdate: (payload) => api.post("/api/risk/policy", payload),
  policyHistory: () => api.get("/api/risk/history"),
  riskStatus: () => api.get("/api/risk/status"),

  strategies: () => api.get("/api/strategies"),
  toggleStrategy: (key, enabled) => api.post(`/api/strategies/${key}/toggle`, { enabled }),
  backtest: (payload) => api.post("/api/backtest", payload),
  backtests: () => api.get("/api/backtests"),

  journal: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/api/journal${query ? `?${query}` : ""}`);
  },
  verifyJournal: () => api.post("/api/journal/verify", {}),
  audits: () => api.get("/api/audits"),
  diagnostics: () => api.get("/api/diagnostics"),

  stopTrading: (reason) => api.post("/api/control/stop", { reason }),
  resumeTrading: () => api.post("/api/control/resume", {}),
  liquidate: (confirmation, reason) => api.post("/api/control/liquidate", { confirmation, reason }),
  killSwitch: (reason) => api.post("/api/control/kill-switch", { reason }),
  releaseKillSwitch: () => api.post("/api/control/release-kill-switch", {}),

  environment: () => api.get("/api/environment"),
  setEnvironment: (payload) => api.post("/api/environment", payload),
  connections: () => api.get("/api/connections"),
  saveMt5: (payload) => api.post("/api/connections/mt5", payload),
  testMt5: (payload = {}) => api.post("/api/connections/mt5/test", payload),
  disableMt5: () => api.post("/api/connections/mt5/disable", {}),
  alerts: () => api.get("/api/alerts"),
  saveAlerts: (payload) => api.post("/api/alerts", payload),
  testAlerts: () => api.post("/api/alerts/test", {}),
  disableAlerts: () => api.post("/api/alerts/disable", {}),

  validations: () => api.get("/api/validations"),
  recordValidation: (payload) => api.post("/api/validations", payload),

  notifications: () => api.get("/api/notifications"),
  markNotificationsRead: (id) => api.post("/api/notifications/read", id ? { id } : {}),
  reconciliations: () => api.get("/api/reconciliations"),
  reconcile: () => api.post("/api/reconcile", {}),

  backups: () => api.get("/api/backups"),
  createBackup: (label) => api.post("/api/backups", { label }),
  verifyBackup: (path) => api.post("/api/backups/verify", { path }),
  drillBackup: () => api.post("/api/backups/drill", {}),

  users: () => api.get("/api/users"),
  createUser: (payload) => api.post("/api/users", payload),
  sessions: () => api.get("/api/sessions"),
  revokeSession: (id) => api.del(`/api/sessions/${encodeURIComponent(id)}`),
};
