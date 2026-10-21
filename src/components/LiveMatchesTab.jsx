import { useState, useMemo } from "react";
import { LEAGUES } from "../data/clubs.js";
import { getOffsetDateStrings, OPTA_PRESET_PACK, parseOptaDataFeed } from "../services/liveMatchesApi.js";
import { OUTCOMES } from "../engine/predictor.js";

export default function LiveMatchesTab({
  dayOffset,
  onChangeDayOffset,
  liveFeed,
  loadingLive,
  onRefreshLive,
  onAutoLearnCompleted,
  onInspectMatch,
  onQuickAddCoupon,
  onOpenInPlay,
  apiCfg,
  onSaveApiCfg,
  onApplyOptaOverrides,
}) {
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [onlySmartValue, setOnlySmartValue] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);
  const [optaInput, setOptaInput] = useState("");
  const [optaStatus, setOptaStatus] = useState("");

  const handleTogglePushAlerts = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setAlertsEnabled((v) => !v);
      return;
    }
    if (Notification.permission === "granted") {
      const next = !alertsEnabled;
      setAlertsEnabled(next);
      if (next && topPicksOfDay[0]) {
        const best = topPicksOfDay[0];
        new Notification("⚡ Alerte Pépite Football AI Ultra", {
          body: `${best.home} vs ${best.away} → ${best.prediction.recommendedMarket.label} (${best.prediction.recommendedMarket.pct}%)`,
        });
      }
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      setAlertsEnabled(true);
      if (topPicksOfDay[0]) {
        const best = topPicksOfDay[0];
        new Notification("⚡ Alertes Pépites Activées !", {
          body: `Pépite n°1 : ${best.home} vs ${best.away} (${best.prediction.recommendedMarket.label} • ${best.prediction.recommendedMarket.pct}%)`,
        });
      }
    }
  };

  const dayTabs = [
    { offset: -1, label: `⏮ Hier (${getOffsetDateStrings(-1).displayFr})` },
    { offset: 0, label: `🔴 Aujourd'hui (${getOffsetDateStrings(0).displayFr})` },
    { offset: 1, label: `⏭ Demain (${getOffsetDateStrings(1).displayFr})` },
    { offset: 2, label: `📅 J+2 (${getOffsetDateStrings(2).displayFr})` },
  ];

  const filteredMatches = useMemo(() => {
    let list = liveFeed.matches || [];
    if (leagueFilter !== "all") list = list.filter((m) => m.league === leagueFilter);
    if (onlySmartValue) {
      list = list.filter(
        (m) =>
          m.prediction?.valueAnalysis?.bestValue?.isValue ||
          (m.prediction?.confidence?.score || 0) >= 58
      );
    }
    return list;
  }, [liveFeed.matches, leagueFilter, onlySmartValue]);

  const completedCount = useMemo(
    () => (liveFeed.matches || []).filter((m) => m.completed && typeof m.scoreHome === "number").length,
    [liveFeed.matches]
  );

  // Top 3 opportunités les plus fiables de la sélection
  const topPicksOfDay = useMemo(() => {
    return [...filteredMatches]
      .filter((m) => m.prediction && !m.completed)
      .sort((a, b) => b.prediction.confidence.score - a.prediction.confidence.score)
      .slice(0, 3);
  }, [filteredMatches]);

  const handleLoadOptaPreset = () => {
    const csvLines = OPTA_PRESET_PACK.map(
      (r) => `${r.team},${r.xgFor90},${r.xgAgainst90},${r.elo}`
    ).join("\n");
    setOptaInput(csvLines);
    const parsed = parseOptaDataFeed(csvLines);
    onApplyOptaOverrides(parsed.overrides, parsed.count);
    setOptaStatus(`✓ Pack Opta Pro (${parsed.count} clubs xG/90 & xGA/90) injecté dans le modèle !`);
  };

  const handleCustomOptaImport = () => {
    try {
      const parsed = parseOptaDataFeed(optaInput);
      onApplyOptaOverrides(parsed.overrides, parsed.count);
      setOptaStatus(`✓ ${parsed.count} clubs mis à jour depuis votre flux Opta / CSV / JSON !`);
    } catch (err) {
      setOptaStatus(`⚠️ ${err.message}`);
    }
  };

  return (
    <div>
      {/* Barre supérieure : Journées + Connecteur API Live / Opta + Auto-Apprentissage */}
      <div className="fai-panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div>
            <div className="fai-section-title" style={{ marginBottom: 4 }}>
              <span>📡 Calendrier & Résultats Temps Réel (Aujourd&apos;hui • Demain • Hier)</span>
            </div>
            <div style={{ fontSize: 12, color: "#9aa3c7" }}>
              Source active :{" "}
              <strong style={{ color: liveFeed.isLiveNetwork ? "#00e676" : "#ffea00" }}>
                {liveFeed.providerUsed || "Connexion..."}
              </strong>{" "}
              • {filteredMatches.length} affiche(s) analysées automatiquement par l&apos;IA
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="fai-btn-secondary"
              disabled={loadingLive}
              onClick={() => onRefreshLive(dayOffset)}
            >
              {loadingLive ? "⏳ Actualisation..." : "🔄 Actualiser le Direct"}
            </button>
            <button
              type="button"
              className="fai-btn-secondary"
              style={{ borderColor: "#00e676", color: "#00e676" }}
              onClick={onAutoLearnCompleted}
              title="Récupère les vrais scores des matchs terminés (Hier & Aujourd'hui) pour corriger et entraîner l'IA automatiquement"
            >
              🧠 Auto-Apprendre Résultats Réels {completedCount > 0 ? `(${completedCount})` : ""}
            </button>
            <button
              type="button"
              className="fai-btn-ghost"
              style={{
                borderColor: onlySmartValue ? "#ffea00" : undefined,
                color: onlySmartValue ? "#ffea00" : undefined,
              }}
              onClick={() => setOnlySmartValue((v) => !v)}
            >
              💎 {onlySmartValue ? "Tous les matchs" : "Smart Money / Value"}
            </button>
            <button
              type="button"
              className="fai-btn-ghost"
              style={{
                borderColor: alertsEnabled ? "#00e676" : undefined,
                color: alertsEnabled ? "#00e676" : undefined,
              }}
              onClick={handleTogglePushAlerts}
            >
              {alertsEnabled ? "🔔 Alertes Mobile ON" : "🔕 Alertes Pépites"}
            </button>
            <button
              type="button"
              className="fai-btn-ghost"
              onClick={() => setShowConnectors((v) => !v)}
            >
              🔌 API-Football &amp; Opta {showConnectors ? "▲" : "▼"}
            </button>
          </div>
        </div>

        {/* Panneau Connecteur Vraie API Pro (API-Football v3 + Import Flux Opta) */}
        {showConnectors && (
          <div
            style={{
              padding: 16,
              marginBottom: 16,
              borderRadius: 12,
              background: "#080a1c",
              border: "1px solid rgba(0, 229, 255, 0.35)",
            }}
          >
            <div className="fai-grid-2">
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#00e5ff", marginBottom: 6 }}>
                  🔑 Connecteur Officiel API-Football (v3.football.api-sports.io)
                </div>
                <p style={{ fontSize: 11.5, color: "#8e98c2", marginBottom: 10 }}>
                  Le flux <strong>ESPN Live Football</strong> fonctionne déjà gratuitement sans clé.
                  Ajoutez votre clé <code>API-Sports</code> pour enrichir avec 100+ ligues mondiales :
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    className="fai-input"
                    placeholder="Clé x-apisports-key (API-Football v3)..."
                    value={apiCfg.apiFootballKey || ""}
                    onChange={(e) =>
                      onSaveApiCfg({ ...apiCfg, apiFootballKey: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="fai-btn-secondary"
                    onClick={() => onRefreshLive(dayOffset)}
                  >
                    Tester
                  </button>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#9d7bff", marginBottom: 6 }}>
                  📊 Importateur Statistique Avancé Opta / FBref (xG/90 &amp; xGA/90)
                </div>
                <textarea
                  rows={2}
                  className="fai-input"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11, marginBottom: 8 }}
                  placeholder="Format CSV : PSG,2.38,0.84,1978 (Équipe, xG/90, xGA/90, Elo)"
                  value={optaInput}
                  onChange={(e) => setOptaInput(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="fai-btn-secondary"
                    onClick={handleLoadOptaPreset}
                  >
                    ⚡ Charger Pack Opta Pro 2026
                  </button>
                  <button
                    type="button"
                    className="fai-btn-ghost"
                    onClick={handleCustomOptaImport}
                  >
                    📥 Injecter mes données Opta
                  </button>
                </div>
                {optaStatus && (
                  <div style={{ fontSize: 11, color: "#00e676", marginTop: 6 }}>{optaStatus}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Onglets Hier / Aujourd'hui / Demain / J+2 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {dayTabs.map((d) => (
            <button
              key={d.offset}
              type="button"
              className={`fai-league-pill ${dayOffset === d.offset ? "selected" : ""}`}
              onClick={() => onChangeDayOffset(d.offset)}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Filtre par championnat */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`fai-quick-chip ${leagueFilter === "all" ? "active" : ""}`}
            style={{
              borderColor: leagueFilter === "all" ? "#00e5ff" : undefined,
              color: leagueFilter === "all" ? "#fff" : undefined,
            }}
            onClick={() => setLeagueFilter("all")}
          >
            🌍 Toutes les compétitions ({(liveFeed.matches || []).length})
          </button>
          {Object.entries(LEAGUES).map(([id, lg]) => {
            const cnt = (liveFeed.matches || []).filter((m) => m.league === id).length;
            if (cnt === 0) return null;
            return (
              <button
                key={id}
                type="button"
                className="fai-quick-chip"
                style={{
                  borderColor: leagueFilter === id ? "#00e5ff" : undefined,
                  color: leagueFilter === id ? "#fff" : undefined,
                }}
                onClick={() => setLeagueFilter(id)}
              >
                {lg.name} ({cnt})
              </button>
            );
          })}
        </div>
      </div>

      {/* Top 3 sélections automatiques de la journée */}
      {topPicksOfDay.length > 0 && (
        <div className="fai-panel" style={{ borderColor: "rgba(0, 230, 118, 0.35)" }}>
          <div className="fai-section-title">
            <span style={{ color: "#00e676" }}>
              🔥 Top {topPicksOfDay.length} Opportunités les Plus Sûres Détectées par l&apos;IA
            </span>
          </div>
          <div className="fai-stats-grid" style={{ marginBottom: 0 }}>
            {topPicksOfDay.map((m) => (
              <div key={`top-${m.externalId}`} className="fai-stat-card">
                <div style={{ fontSize: 10, color: "#7f89b2", marginBottom: 4 }}>
                  {LEAGUES[m.league]?.name} • {m.statusText}
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
                  {m.home} vs {m.away}
                </div>
                <div style={{ fontSize: 12, color: "#00e676", fontWeight: 700, marginBottom: 8 }}>
                  ★ {m.prediction.recommendedMarket.label} ({m.prediction.recommendedMarket.pct}%)
                </div>
                <button
                  type="button"
                  className="fai-btn-secondary"
                  style={{ width: "100%", padding: "7px 10px" }}
                  onClick={() => onQuickAddCoupon(m)}
                >
                  🎰 Ajouter au Coupon (~{m.prediction.recommendedMarket.marketOdd.toFixed(2)})
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liste complète des matchs de la journée avec prédictions IA intégrées */}
      {loadingLive ? (
        <div className="fai-panel" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
          <div style={{ color: "#9aa3c7" }}>
            Récupération et modélisation mathématique des matchs en cours...
          </div>
        </div>
      ) : (
        filteredMatches.map((m) => {
          const pred = m.prediction;
          const maxIdx = pred.probs.indexOf(Math.max(...pred.probs));
          const realOutcome =
            m.completed && typeof m.scoreHome === "number" && typeof m.scoreAway === "number"
              ? m.scoreHome > m.scoreAway
                ? 0
                : m.scoreHome === m.scoreAway
                  ? 1
                  : 2
              : null;

          return (
            <div key={m.externalId} className="fai-panel" style={{ padding: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: LEAGUES[m.league]?.color || "#00e5ff",
                      textTransform: "uppercase",
                    }}
                  >
                    {LEAGUES[m.league]?.name}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background:
                        m.state === "in" ? "rgba(255,61,90,0.2)" : "rgba(255,255,255,0.06)",
                      color: m.state === "in" ? "#ff3d5a" : "#cbd2f5",
                      fontWeight: 700,
                    }}
                  >
                    {m.statusText}
                  </span>
                  {m.venue && <span style={{ fontSize: 11, color: "#6c769f" }}>🏟️ {m.venue}</span>}
                </div>

                <div style={{ fontSize: 11, color: pred.confidence.color, fontWeight: 800 }}>
                  Fiabilité IA : {pred.confidence.score}/100 ({pred.confidence.label})
                </div>
              </div>

              {/* Affiche avec logos éventuels + score live/final + probabilités 1X2 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr auto",
                  gap: 14,
                  alignItems: "center",
                }}
                className="fai-live-row"
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 17,
                      fontWeight: 800,
                      flexWrap: "wrap",
                    }}
                  >
                    {m.homeLogo && (
                      <img src={m.homeLogo} alt="" width={22} height={22} loading="lazy" />
                    )}
                    <span>{m.home}</span>
                    {typeof m.scoreHome === "number" && typeof m.scoreAway === "number" ? (
                      <span
                        style={{
                          padding: "2px 9px",
                          borderRadius: 7,
                          background: "rgba(0,229,255,0.16)",
                          color: "#00e5ff",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {m.scoreHome} - {m.scoreAway}
                      </span>
                    ) : (
                      <span style={{ color: "#5e6790", fontSize: 13 }}>vs</span>
                    )}
                    {m.awayLogo && (
                      <img src={m.awayLogo} alt="" width={22} height={22} loading="lazy" />
                    )}
                    <span>{m.away}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#8e98c2", marginTop: 5 }}>
                    Projection :{" "}
                    <strong style={{ color: "#00e5ff" }}>
                      {pred.xg.home.toFixed(2)} - {pred.xg.away.toFixed(2)} xG
                    </strong>{" "}
                    • Top score : <strong>{pred.topScores[0].score}</strong> (
                    {pred.topScores[0].pct}%)
                    {realOutcome !== null && (
                      <span
                        style={{
                          marginLeft: 8,
                          color: realOutcome === maxIdx ? "#00e676" : "#ff9100",
                          fontWeight: 700,
                        }}
                      >
                        {realOutcome === maxIdx
                          ? "✓ Prédiction 1X2 validée !"
                          : "⚡ Résultat prêt à enrichir l'IA"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Triplet 1 / N / 2 compact */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {["1", "N", "2"].map((lbl, idx) => (
                    <div
                      key={lbl}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 8,
                        textAlign: "center",
                        background:
                          idx === maxIdx ? "rgba(0, 229, 255, 0.14)" : "rgba(8, 10, 26, 0.8)",
                        border: `1px solid ${
                          idx === maxIdx ? "rgba(0, 229, 255, 0.5)" : "var(--border-muted)"
                        }`,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      <div style={{ fontSize: 10, color: "#7f89b2" }}>{lbl}</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>
                        {pred.probs[idx]}%
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions rapides */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="fai-btn-ghost"
                    onClick={() => onInspectMatch(m)}
                  >
                    🔍 Analyse complète
                  </button>
                  {onOpenInPlay && !m.completed && (
                    <button
                      type="button"
                      className="fai-btn-ghost"
                      onClick={() => onOpenInPlay(m)}
                    >
                      🔴 Live In-Play
                    </button>
                  )}
                  {!m.completed && (
                    <button
                      type="button"
                      className="fai-btn-secondary"
                      onClick={() => onQuickAddCoupon(m)}
                    >
                      🎰 + Coupon ({pred.recommendedMarket.code})
                    </button>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, color: "#9aa3c7" }}>
                💡 Pronostic IA :{" "}
                <strong style={{ color: pred.confidence.color }}>{OUTCOMES[maxIdx]}</strong> •
                Option sécurisée :{" "}
                <strong style={{ color: "#00e676" }}>
                  {pred.recommendedMarket.label} ({pred.recommendedMarket.pct}%)
                </strong>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
