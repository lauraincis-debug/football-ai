import { useState, useEffect, useMemo } from "react";
import { CLUBS_DB } from "../data/clubs.js";
import { computeFullPrediction } from "../engine/predictor.js";
import { computeLiveInPlayPrediction } from "../engine/inPlayEngine.js";

export default function InPlayTab({
  defaultHome = "PSG",
  defaultAway = "Marseille",
  defaultLeague = "ligue1",
  modelState,
  liveMatches = [],
  onAddLivePickToCoupon,
}) {
  const [home, setHome] = useState(defaultHome);
  const [away, setAway] = useState(defaultAway);
  const [league, setLeague] = useState(defaultLeague);

  const [minute, setMinute] = useState(64);
  const [scoreHome, setScoreHome] = useState(0);
  const [scoreAway, setScoreAway] = useState(1);
  const [redCardsHome, setRedCardsHome] = useState(0);
  const [redCardsAway, setRedCardsAway] = useState(0);
  const [momentum, setMomentum] = useState(45);
  const [shotsOnTargetHome, setShotsOnTargetHome] = useState(7);
  const [shotsOnTargetAway, setShotsOnTargetAway] = useState(2);
  const [autoTicking, setAutoTicking] = useState(false);

  useEffect(() => {
    setHome(defaultHome);
    setAway(defaultAway);
    setLeague(defaultLeague);
  }, [defaultHome, defaultAway, defaultLeague]);

  // Simulateur temps réel de chrono minute par minute
  useEffect(() => {
    if (!autoTicking) return undefined;
    const timer = setInterval(() => {
      setMinute((m) => (m >= 95 ? 95 : m + 1));
    }, 1200);
    return () => clearInterval(timer);
  }, [autoTicking]);

  const inProgressMatches = useMemo(
    () =>
      liveMatches.filter(
        (m) => !m.completed && (m.inProgress || typeof m.scoreHome === "number")
      ),
    [liveMatches]
  );

  const preMatch = useMemo(
    () => computeFullPrediction(home, away, league, modelState, null),
    [home, away, league, modelState]
  );

  const livePred = useMemo(
    () =>
      computeLiveInPlayPrediction(preMatch, {
        minute,
        scoreHome,
        scoreAway,
        redCardsHome,
        redCardsAway,
        momentum,
        shotsOnTargetHome,
        shotsOnTargetAway,
      }),
    [
      preMatch,
      minute,
      scoreHome,
      scoreAway,
      redCardsHome,
      redCardsAway,
      momentum,
      shotsOnTargetHome,
      shotsOnTargetAway,
    ]
  );

  const loadFromLiveMatch = (m) => {
    setHome(m.home);
    setAway(m.away);
    setLeague(m.league || "ucl");
    setScoreHome(typeof m.scoreHome === "number" ? m.scoreHome : 0);
    setScoreAway(typeof m.scoreAway === "number" ? m.scoreAway : 0);
    const parsedMin = parseInt(String(m.statusDetail || "45"), 10);
    setMinute(Number.isFinite(parsedMin) ? Math.min(95, Math.max(1, parsedMin)) : 55);
    setRedCardsHome(0);
    setRedCardsAway(0);
    setMomentum(15);
  };

  const alertColors = {
    hot: { bg: "rgba(255, 61, 113, 0.14)", border: "#ff3d71", text: "#ff85a2" },
    warning: { bg: "rgba(255, 179, 0, 0.14)", border: "#ffb300", text: "#ffd54f" },
    lock: { bg: "rgba(0, 230, 118, 0.14)", border: "#00e676", text: "#69f0ae" },
    neutral: { bg: "rgba(0, 229, 255, 0.11)", border: "#00e5ff", text: "#84ffff" },
  }[livePred.alertLevel];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* En-tête Live In-Play */}
      <div className="fai-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#ff1744",
                  boxShadow: "0 0 12px #ff1744",
                }}
              />
              <h2 style={{ margin: 0, fontSize: 18 }}>
                🔴 Moteur Live In-Play — Probabilités Minute par Minute
              </h2>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#8e98c2" }}>
              Recalcul Poisson résiduel instantané selon la minute, le score, les cartons rouges, les tirs cadrés et la pression tactique.
            </p>
          </div>
          <button
            type="button"
            className="fai-btn-secondary"
            onClick={() => setAutoTicking((v) => !v)}
          >
            {autoTicking ? "⏸️ Pause Chrono Live" : "▶️ Simuler Chrono Temps Réel"}
          </button>
        </div>

        {/* Raccourcis matchs réellement en cours s'il y en a */}
        {inProgressMatches.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#ff80ab", marginBottom: 6 }}>
              📡 MATCHS EN DIRECT DÉTECTÉS (1 CLIC POUR IMPORTER) :
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {inProgressMatches.map((m) => (
                <button
                  key={m.externalId || `${m.home}-${m.away}`}
                  type="button"
                  className="fai-btn-ghost"
                  onClick={() => loadFromLiveMatch(m)}
                >
                  🔴 {m.home} {m.scoreHome ?? 0}-{m.scoreAway ?? 0} {m.away} ({m.statusDetail || "LIVE"})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scénarios rapides */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button
            type="button"
            className="fai-btn-ghost"
            onClick={() => {
              setMinute(67);
              setScoreHome(0);
              setScoreAway(1);
              setMomentum(65);
              setShotsOnTargetHome(8);
              setShotsOnTargetAway(2);
              setRedCardsHome(0);
              setRedCardsAway(0);
            }}
          >
            🔥 Favori mené 0-1 qui pousse fort (67&apos;)
          </button>
          <button
            type="button"
            className="fai-btn-ghost"
            onClick={() => {
              setMinute(58);
              setScoreHome(1);
              setScoreAway(1);
              setRedCardsHome(0);
              setRedCardsAway(1);
              setMomentum(55);
            }}
          >
            🟥 Carton rouge adverse à 1-1 (58&apos;)
          </button>
          <button
            type="button"
            className="fai-btn-ghost"
            onClick={() => {
              setMinute(81);
              setScoreHome(2);
              setScoreAway(2);
              setRedCardsHome(0);
              setRedCardsAway(0);
              setMomentum(20);
            }}
          >
            ⚡ Money-Time K.O. 2-2 (81&apos;)
          </button>
        </div>

        {/* Sélection des 2 clubs + Tableau d'affichage Live */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 12,
            marginTop: 16,
            alignItems: "center",
          }}
        >
          <div>
            <label style={{ fontSize: 11, color: "#8e98c2", fontWeight: 700 }}>🏠 DOMICILE</label>
            <input
              list="football-ai-clubs"
              className="fai-input"
              value={home}
              onChange={(e) => setHome(e.target.value)}
            />
          </div>

          {/* Scoreboard central interactif */}
          <div
            style={{
              background: "rgba(6, 9, 26, 0.85)",
              border: "1px solid rgba(0, 229, 255, 0.3)",
              borderRadius: 14,
              padding: "12px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 900, color: "#ff5252", marginBottom: 6 }}>
              ⏱️ {minute}&apos; MINUTE DE JEU
            </div>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className="fai-btn-ghost"
                onClick={() => setScoreHome((s) => Math.max(0, s - 1))}
              >
                −
              </button>
              <span style={{ fontSize: 30, fontWeight: 900, color: "#00e5ff", minWidth: 28 }}>
                {scoreHome}
              </span>
              <button
                type="button"
                className="fai-btn-ghost"
                onClick={() => setScoreHome((s) => s + 1)}
              >
                +
              </button>

              <span style={{ fontSize: 22, fontWeight: 800, color: "#64748b" }}>:</span>

              <button
                type="button"
                className="fai-btn-ghost"
                onClick={() => setScoreAway((s) => Math.max(0, s - 1))}
              >
                −
              </button>
              <span style={{ fontSize: 30, fontWeight: 900, color: "#d500f9", minWidth: 28 }}>
                {scoreAway}
              </span>
              <button
                type="button"
                className="fai-btn-ghost"
                onClick={() => setScoreAway((s) => s + 1)}
              >
                +
              </button>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: "#8e98c2", fontWeight: 700 }}>✈️ EXTÉRIEUR</label>
            <input
              list="football-ai-clubs"
              className="fai-input"
              value={away}
              onChange={(e) => setAway(e.target.value)}
            />
          </div>
        </div>

        {/* Curseurs tactiques Live */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            marginTop: 16,
          }}
        >
          <div style={{ background: "rgba(255,255,255,0.03)", padding: 12, borderRadius: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
              <span>⏱️ Minute actuelle</span>
              <span style={{ color: "#00e5ff" }}>{minute}&apos; / 95&apos;</span>
            </div>
            <input
              type="range"
              min="1"
              max="95"
              value={minute}
              onChange={(e) => setMinute(Number(e.target.value))}
              style={{ width: "100%", marginTop: 8, accentColor: "#00e5ff" }}
            />
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", padding: 12, borderRadius: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
              <span>⚡ Domination / Pression</span>
              <span style={{ color: momentum >= 0 ? "#00e676" : "#ff80ab" }}>
                {momentum > 0 ? `+${momentum}% ${preMatch.home}` : momentum < 0 ? `${Math.abs(momentum)}% ${preMatch.away}` : "Équilibré"}
              </span>
            </div>
            <input
              type="range"
              min="-100"
              max="100"
              value={momentum}
              onChange={(e) => setMomentum(Number(e.target.value))}
              style={{ width: "100%", marginTop: 8, accentColor: "#d500f9" }}
            />
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", padding: 12, borderRadius: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              🟥 Cartons Rouges &amp; Tirs Cadrés
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
              <label>
                🟥 {preMatch.home} :{" "}
                <select
                  value={redCardsHome}
                  onChange={(e) => setRedCardsHome(Number(e.target.value))}
                  style={{ background: "#0d122b", color: "#fff", borderRadius: 6, padding: "2px 6px" }}
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
              <label>
                🟥 {preMatch.away} :{" "}
                <select
                  value={redCardsAway}
                  onChange={(e) => setRedCardsAway(Number(e.target.value))}
                  style={{ background: "#0d122b", color: "#fff", borderRadius: 6, padding: "2px 6px" }}
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 6 }}>
              <label>
                🎯 Cadrés Dom :{" "}
                <input
                  type="number"
                  min="0"
                  max="25"
                  value={shotsOnTargetHome}
                  onChange={(e) => setShotsOnTargetHome(Number(e.target.value))}
                  style={{ width: 46, background: "#0d122b", color: "#fff", border: "1px solid #334155", borderRadius: 6, padding: "2px 4px" }}
                />
              </label>
              <label>
                🎯 Cadrés Ext :{" "}
                <input
                  type="number"
                  min="0"
                  max="25"
                  value={shotsOnTargetAway}
                  onChange={(e) => setShotsOnTargetAway(Number(e.target.value))}
                  style={{ width: 46, background: "#0d122b", color: "#fff", border: "1px solid #334155", borderRadius: 6, padding: "2px 4px" }}
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Verdict Cash-Out & Alerte But Imminent */}
      <div
        style={{
          background: alertColors.bg,
          border: `1px solid ${alertColors.border}`,
          borderRadius: 16,
          padding: "14px 18px",
          color: alertColors.text,
          fontWeight: 800,
          fontSize: 13.5,
        }}
      >
        {livePred.liveVerdict}
      </div>

      {/* Résultats Live : 1X2 Temps Réel + Prochain But + Over/Under Dynamique */}
      <div className="fai-panel">
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
          📊 Probabilités 1X2 Live ({minute}&apos; • xG restants : {livePred.remainingXg.home} vs {livePred.remainingXg.away})
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          {[
            {
              label: `1 • ${preMatch.home}`,
              pct: livePred.liveProbs[0],
              delta: livePred.deltaFromPreMatch[0],
              odd: livePred.fairLiveOdds[0],
              color: "#00e5ff",
            },
            {
              label: "N • Match Nul",
              pct: livePred.liveProbs[1],
              delta: livePred.deltaFromPreMatch[1],
              odd: livePred.fairLiveOdds[1],
              color: "#ffb300",
            },
            {
              label: `2 • ${preMatch.away}`,
              pct: livePred.liveProbs[2],
              delta: livePred.deltaFromPreMatch[2],
              odd: livePred.fairLiveOdds[2],
              color: "#d500f9",
            },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>{item.label}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: item.color, margin: "4px 0" }}>
                {item.pct}%
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#cbd5e1" }}>
                <span>Juste cote : @{item.odd.toFixed(2)}</span>
                <span style={{ color: item.delta >= 0 ? "#00e676" : "#ff5252", fontWeight: 800 }}>
                  {item.delta >= 0 ? `+${item.delta}%` : `${item.delta}%`} vs 0&apos;
                </span>
              </div>
              {onAddLivePickToCoupon && (
                <button
                  type="button"
                  className="fai-btn-ghost"
                  style={{ width: "100%", marginTop: 8, fontSize: 11 }}
                  onClick={() =>
                    onAddLivePickToCoupon({
                      home: preMatch.home,
                      away: preMatch.away,
                      league,
                      probs: livePred.liveProbs,
                      selectedMarket: {
                        label: `[LIVE ${minute}'] ${item.label}`,
                        pct: item.pct,
                        bookOdd: item.odd,
                      },
                    })
                  }
                >
                  + Ajouter au Coupon (@{item.odd.toFixed(2)})
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Marchés Live Spéciaux */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
            gap: 10,
            marginTop: 14,
          }}
        >
          <div style={{ background: "rgba(0,229,255,0.08)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#7dd3fc", fontWeight: 800 }}>⚡ PROCHAIN BUT ({preMatch.home})</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", marginTop: 4 }}>{livePred.nextGoalProbs[0]}%</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Extérieur : {livePred.nextGoalProbs[2]}% • Aucun : {livePred.nextGoalProbs[1]}%</div>
          </div>

          <div style={{ background: "rgba(255,61,113,0.1)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#ff80ab", fontWeight: 800 }}>🔥 BUT DANS LES 15 PROCHAINES MIN</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", marginTop: 4 }}>{livePred.goalNext15Pct}%</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>xG restants totaux : {livePred.remainingXg.total}</div>
          </div>

          <div style={{ background: "rgba(0,230,118,0.1)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#69f0ae", fontWeight: 800 }}>⚽ OVER +{livePred.dynamicLine} BUTS</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", marginTop: 4 }}>{livePred.overCurrentPlus05Pct}%</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Over +{livePred.dynamicLinePlus1} buts : {livePred.overCurrentPlus15Pct}%</div>
          </div>

          <div style={{ background: "rgba(213,0,249,0.1)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#ea80fc", fontWeight: 800 }}>🎯 SCORES FINAUX LES PLUS PROBABLES</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginTop: 6 }}>
              {livePred.topFinalScores.map((s) => `${s.score} (${s.pct}%)`).join(" • ")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
