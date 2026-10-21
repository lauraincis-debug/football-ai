import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LEAGUES,
  CLUBS_DB,
  CALIBRATION_MATCHES,
  getClubsForLeague,
  resolveClub,
  canonicalTeamName,
  normalizeKey,
} from "./data/clubs.js";
import {
  OUTCOMES,
  isValidated,
  rebuildModelState,
  runContinuousEvolution,
  computeFullPrediction,
  generateExpertAnalysis,
  getConfidence,
  checkPickResult,
} from "./engine/predictor.js";
import {
  loadFirebaseSyncConfig,
  saveFirebaseSyncConfig,
  pushStateToFirebase,
  pullStateFromFirebase,
} from "./firebase/cloudSync.js";
import {
  loadExternalApiConfig,
  saveExternalApiConfig,
  fetchScheduleForOffset,
} from "./services/liveMatchesApi.js";
import LiveMatchesTab from "./components/LiveMatchesTab.jsx";
import HeadToHeadTab from "./components/HeadToHeadTab.jsx";
import VideoAnalysisTab from "./components/VideoAnalysisTab.jsx";
import FantasyTab from "./components/FantasyTab.jsx";
import CloeBridgeTab from "./components/CloeBridgeTab.jsx";
import InPlayTab from "./components/InPlayTab.jsx";
import BankrollAndTicketsPanel from "./components/BankrollAndTicketsPanel.jsx";
import {
  FATIGUE_OPTIONS,
  STAKES_OPTIONS,
  getSquadStarsForTeam,
} from "./engine/contextModifiers.js";

// ============================================================
// FOOTBALL AI ULTRA v3 — Application Complète Auto-Évolutive
// ============================================================

const STORAGE_KEY = "football_ai_ultra_v2";
const LEGACY_KEY = "football_ai_memory";

function loadPersistedData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        predictions: Array.isArray(parsed.predictions) ? parsed.predictions : [],
        coupon: Array.isArray(parsed.coupon) ? parsed.coupon : [],
        stake: typeof parsed.stake === "number" ? parsed.stake : 2000,
        currency: parsed.currency || "FCFA",
        optaOverrides: parsed.optaOverrides || {},
        evolvedHyper: parsed.evolvedHyper || null,
        learnedExternalIds: Array.isArray(parsed.learnedExternalIds)
          ? parsed.learnedExternalIds
          : [],
      };
    }
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      return {
        predictions: Array.isArray(legacy.predictions) ? legacy.predictions : [],
        coupon: [],
        stake: 2000,
        currency: "FCFA",
        optaOverrides: {},
        evolvedHyper: null,
        learnedExternalIds: [],
      };
    }
  } catch {
    // ignore
  }
  return {
    predictions: [],
    coupon: [],
    stake: 2000,
    currency: "FCFA",
    optaOverrides: {},
    evolvedHyper: null,
    learnedExternalIds: [],
  };
}

function savePersistedData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function formatMoney(amount, currency) {
  if (currency === "FCFA") {
    return `${Math.round(amount).toLocaleString("fr-FR")} FCFA`;
  }
  return `${amount.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function Stars({ count }) {
  return (
    <span style={{ letterSpacing: 2 }} aria-label={`${count} étoiles sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            color: i <= count ? "#ffd700" : "#2b3058",
            fontSize: 14,
          }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function FormBadges({ form }) {
  if (!form || form.length === 0) {
    return <span style={{ fontSize: 11, color: "#5e6790" }}>Forme initiale</span>;
  }
  return (
    <span>
      {form.map((res, idx) => {
        const bg =
          res === "V"
            ? "rgba(0, 230, 118, 0.2)"
            : res === "N"
              ? "rgba(255, 234, 0, 0.18)"
              : "rgba(255, 61, 90, 0.2)";
        const col = res === "V" ? "#00e676" : res === "N" ? "#ffea00" : "#ff3d5a";
        return (
          <span key={idx} className="fai-form-dot" style={{ background: bg, color: col }}>
            {res}
          </span>
        );
      })}
    </span>
  );
}

function ProbBar({ label, value, fairOdd, subInfo, color, isWinner, valueItem }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 5,
          fontSize: 13,
          color: isWinner ? "#fff" : "#a2abcd",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: isWinner ? 800 : 500 }}>{label}</span>
          {valueItem?.isValue && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(0, 230, 118, 0.18)",
                border: "1px solid #00e676",
                color: "#00e676",
              }}
            >
              VALUE +{valueItem.evPct}%
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-mono)" }}>
          {subInfo && <span style={{ fontSize: 11, color: "#68729b" }}>{subInfo}</span>}
          {fairOdd && (
            <span
              style={{
                fontSize: 11,
                padding: "1px 6px",
                borderRadius: 5,
                background: "rgba(255,255,255,0.05)",
                color: "#9aa3c7",
              }}
            >
              Cote IA {fairOdd.toFixed(2)}
            </span>
          )}
          <span style={{ fontWeight: 800, fontSize: 15, color: isWinner ? color : "#cfd6f4" }}>
            {value}%
          </span>
        </div>
      </div>
      <div style={{ height: 9, background: "#141836", borderRadius: 5, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${value}%`,
            background: isWinner
              ? `linear-gradient(90deg, ${color}cc, ${color})`
              : "linear-gradient(90deg, #323968, #48528e)",
            borderRadius: 5,
            transition: "width 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: isWinner ? `0 0 14px ${color}66` : "none",
          }}
        />
      </div>
    </div>
  );
}

function ScoreHeatmap({ heatmap, homeName, awayName }) {
  const maxCellProb = useMemo(() => {
    let m = 0.01;
    for (const row of heatmap) {
      for (const cell of row) {
        if (cell.prob > m) m = cell.prob;
      }
    }
    return m;
  }, [heatmap]);

  return (
    <div>
      <div style={{ fontSize: 11, color: "#7f89b2", marginBottom: 6 }}>
        Lignes : <strong>{homeName}</strong> (0–4 buts) • Colonnes : <strong>{awayName}</strong> (0–4 buts)
      </div>
      <div className="fai-heatmap">
        <div />
        {[0, 1, 2, 3, 4].map((col) => (
          <div
            key={`h-${col}`}
            style={{
              textAlign: "center",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "#7f89b2",
              fontWeight: 700,
            }}
          >
            {col}
          </div>
        ))}
        {heatmap.map((row, x) => [
          <div
            key={`lbl-${x}`}
            style={{
              textAlign: "center",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "#7f89b2",
              fontWeight: 700,
            }}
          >
            {x}
          </div>,
          ...row.map((cell, y) => {
            const intensity = Math.min(1, cell.prob / maxCellProb);
            const baseRgb =
              x > y ? "0, 229, 255" : x === y ? "255, 214, 0" : "255, 77, 136";
            return (
              <div
                key={`c-${x}-${y}`}
                className="fai-heat-cell"
                title={`Score exact ${x} - ${y} : ${cell.pct}%`}
                style={{
                  background: `rgba(${baseRgb}, ${(0.06 + intensity * 0.48).toFixed(2)})`,
                  color: intensity > 0.55 ? "#ffffff" : "#9aa3c7",
                  fontWeight: intensity > 0.6 ? 800 : 500,
                  borderColor:
                    intensity > 0.85 ? `rgba(${baseRgb}, 0.8)` : "rgba(255,255,255,0.05)",
                }}
              >
                {cell.pct.toFixed(1)}%
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}

function LearningCurveChart({ curve }) {
  if (!curve || curve.length < 2) return null;
  const W = 440;
  const H = 120;
  const pts = curve
    .map((c, idx) => {
      const x = 16 + (idx / Math.max(1, curve.length - 1)) * (W - 32);
      const y = H - 16 - (c.cumulativeAcc / 100) * (H - 32);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 130 }}>
      {[25, 50, 75].map((pct) => {
        const y = H - 16 - (pct / 100) * (H - 32);
        return (
          <g key={pct}>
            <line
              x1={16}
              y1={y}
              x2={W - 16}
              y2={y}
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="3,3"
            />
            <text x={2} y={y + 3} fill="#6b749e" fontSize="9">
              {pct}%
            </text>
          </g>
        );
      })}
      <polyline
        fill="none"
        stroke="#00e676"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

function PredictionCard({ pred, onValidate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [scoreH, setScoreH] = useState(
    typeof pred.scoreHome === "number" ? String(pred.scoreHome) : ""
  );
  const [scoreA, setScoreA] = useState(
    typeof pred.scoreAway === "number" ? String(pred.scoreAway) : ""
  );

  const validated = isValidated(pred);
  const maxIdx = pred.probs.indexOf(Math.max(...pred.probs));
  const conf = getConfidence(pred.probs, pred.rawProbs);
  const is1X2Hit = validated ? pred.result === maxIdx : null;
  const pickWon = validated ? checkPickResult(pred) : null;

  const submitExactScore = (e) => {
    e.preventDefault();
    const h = parseInt(scoreH, 10);
    const a = parseInt(scoreA, 10);
    if (Number.isNaN(h) || Number.isNaN(a) || h < 0 || a < 0 || h > 20 || a > 20) return;
    const outcome = h > a ? 0 : h === a ? 1 : 2;
    onValidate(pred.id, outcome, h, a);
    setEditing(false);
  };

  return (
    <div
      style={{
        background: "linear-gradient(140deg, #0c0f26 0%, #131738 100%)",
        border: `1px solid ${
          validated ? (is1X2Hit ? "rgba(0,230,118,0.65)" : "rgba(255,61,90,0.55)") : "#232954"
        }`,
        borderRadius: 16,
        padding: 20,
        marginBottom: 14,
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: LEAGUES[pred.league]?.color || "#7c4dff",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              marginBottom: 4,
            }}
          >
            {LEAGUES[pred.league]?.name || pred.league}
            {pred.autoLearned && (
              <span style={{ marginLeft: 8, color: "#00e5ff" }}>• 🤖 Auto-Appris Live</span>
            )}
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span>{pred.home}</span>
            {typeof pred.scoreHome === "number" && typeof pred.scoreAway === "number" ? (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  padding: "2px 10px",
                  borderRadius: 8,
                  background: "rgba(0, 229, 255, 0.14)",
                  border: "1px solid rgba(0, 229, 255, 0.35)",
                  color: "#00e5ff",
                  fontSize: 15,
                }}
              >
                {pred.scoreHome} - {pred.scoreAway}
              </span>
            ) : (
              <span style={{ color: "#5c658e", fontSize: 14 }}>vs</span>
            )}
            <span>{pred.away}</span>
          </div>
          <div style={{ fontSize: 11, color: "#68729b", marginTop: 4 }}>
            📅 {pred.date}
            {pred.xg && (
              <span>
                {" "}
                • Projection IA : {pred.xg.home.toFixed(2)} - {pred.xg.away.toFixed(2)} xG
              </span>
            )}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: conf.color,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 3,
            }}
          >
            Fiabilité {conf.score}/100 • {conf.label}
          </div>
          <Stars count={conf.stars} />
        </div>
      </div>

      {pred.probs.map((p, i) => (
        <ProbBar
          key={i}
          label={OUTCOMES[i]}
          value={p}
          fairOdd={pred.fairOdds?.[i]}
          color={conf.color}
          isWinner={i === maxIdx}
        />
      ))}

      <div
        style={{
          marginTop: 12,
          padding: "10px 14px",
          background: "#080a1c",
          borderRadius: 10,
          border: `1px solid ${conf.color}40`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: "#7882ab", textTransform: "uppercase", fontSize: 10, letterSpacing: 1 }}>
              Pronostic 1X2 :{" "}
            </span>
            <strong style={{ color: conf.color }}>{OUTCOMES[maxIdx]}</strong>
          </div>
          {pred.selectedMarket && (
            <div style={{ fontSize: 11, color: "#9aa3c7", marginTop: 2 }}>
              Option Coupon : <strong>{pred.selectedMarket.label}</strong> ({pred.selectedMarket.pct}%)
              {pickWon !== null && (
                <span style={{ marginLeft: 6, color: pickWon ? "#00e676" : "#ff3d5a", fontWeight: 700 }}>
                  {pickWon ? "✓ Option gagnante" : "✗ Option perdue"}
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {validated && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 800,
                padding: "5px 10px",
                borderRadius: 8,
                background: is1X2Hit ? "rgba(0,230,118,0.16)" : "rgba(255,61,90,0.16)",
                color: is1X2Hit ? "#00e676" : "#ff3d5a",
              }}
            >
              {is1X2Hit ? "✓ 1X2 Exact" : `✗ Réel : ${OUTCOMES[pred.result]}`}
            </span>
          )}
          <button
            type="button"
            className="fai-btn-ghost"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Fermer" : validated ? "Modifier score" : "✓ Valider résultat"}
          </button>
          <button
            type="button"
            onClick={() => onDelete(pred.id)}
            style={{
              background: "transparent",
              border: "none",
              color: "#6b749e",
              cursor: "pointer",
              fontSize: 12,
              padding: "4px 6px",
            }}
            title="Supprimer"
          >
            ✕
          </button>
        </div>
      </div>

      {editing && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 10,
            background: "rgba(18, 22, 52, 0.9)",
            border: "1px solid #2b3368",
          }}
        >
          <form
            onSubmit={submitExactScore}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "#00e5ff" }}>
              ⚽ Score exact :
            </span>
            <input
              type="number"
              min="0"
              max="20"
              placeholder={pred.home}
              value={scoreH}
              onChange={(e) => setScoreH(e.target.value)}
              className="fai-input"
              style={{ width: 82, padding: "7px 10px", textAlign: "center" }}
            />
            <span style={{ fontWeight: 800 }}>-</span>
            <input
              type="number"
              min="0"
              max="20"
              placeholder={pred.away}
              value={scoreA}
              onChange={(e) => setScoreA(e.target.value)}
              className="fai-input"
              style={{ width: 82, padding: "7px 10px", textAlign: "center" }}
            />
            <button type="submit" className="fai-btn-secondary">
              Enregistrer &amp; Recalibrer IA
            </button>
          </form>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {OUTCOMES.map((o, i) => (
              <button
                key={i}
                type="button"
                className="fai-btn-ghost"
                style={{ flex: 1, minWidth: 120 }}
                onClick={() => {
                  onValidate(pred.id, i, undefined, undefined);
                  setEditing(false);
                }}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// COMPOSANT PRINCIPAL : FOOTBALL AI ULTRA v3
// ============================================================

export default function FootballAI() {
  const initial = useMemo(() => loadPersistedData(), []);
  const [predictions, setPredictions] = useState(initial.predictions);
  const [coupon, setCoupon] = useState(initial.coupon);
  const [stake, setStake] = useState(initial.stake);
  const [currency, setCurrency] = useState(initial.currency);
  const [optaOverrides, setOptaOverrides] = useState(initial.optaOverrides);
  const [evolvedHyper, setEvolvedHyper] = useState(initial.evolvedHyper);
  const [learnedExternalIds, setLearnedExternalIds] = useState(initial.learnedExternalIds);

  const [tab, setTab] = useState("predict");
  const [form, setForm] = useState({
    home: "PSG",
    away: "Marseille",
    league: "ligue1",
  });
  const [showOddsInput, setShowOddsInput] = useState(false);
  const [bookOdds, setBookOdds] = useState({ odd1: "", oddN: "", odd2: "" });
  const [showContextBox, setShowContextBox] = useState(false);
  const [matchContext, setMatchContext] = useState({
    absentHomeIds: [],
    absentAwayIds: [],
    fatigueHome: "fresh",
    fatigueAway: "fresh",
    stakes: "standard",
  });
  const [activeMatch, setActiveMatch] = useState({
    home: "PSG",
    away: "Marseille",
    league: "ligue1",
  });
  const [selectedMarketCode, setSelectedMarketCode] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [videoInsight, setVideoInsight] = useState(null);

  // État des Matchs du Jour & Demain (API Live)
  const [apiCfg, setApiCfg] = useState(() => loadExternalApiConfig());
  const [dayOffset, setDayOffset] = useState(0);
  const [rawLiveFeed, setRawLiveFeed] = useState({
    matches: [],
    providerUsed: "Initialisation...",
    isLiveNetwork: false,
  });
  const [loadingLive, setLoadingLive] = useState(false);

  const [historyFilter, setHistoryFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [cloudCfg, setCloudCfg] = useState(() => loadFirebaseSyncConfig());
  const [cloudBusy, setCloudBusy] = useState(false);
  const [toast, setToast] = useState("");
  const fileInputRef = useRef(null);

  const triggerToast = useCallback((msg) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const handleInstallPWA = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => {});
    setInstallPromptEvent(null);
  };

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Persistance intégrale de la mémoire enrichie v3
  useEffect(() => {
    savePersistedData({
      predictions,
      coupon,
      stake,
      currency,
      optaOverrides,
      evolvedHyper,
      learnedExternalIds,
    });
  }, [predictions, coupon, stake, currency, optaOverrides, evolvedHyper, learnedExternalIds]);

  // Reconstruction mémoïsée de toute l'intelligence adaptative + Journal d'Erreurs
  const modelState = useMemo(
    () => rebuildModelState(predictions, { optaOverrides, evolvedHyper }),
    [predictions, optaOverrides, evolvedHyper]
  );

  // Enrichir chaque match du calendrier live avec sa prédiction mathématique à jour
  const enrichedLiveFeed = useMemo(
    () => ({
      ...rawLiveFeed,
      matches: (rawLiveFeed.matches || []).map((m) => ({
        ...m,
        prediction: computeFullPrediction(m.home, m.away, m.league, modelState, m.liveOdds),
      })),
    }),
    [rawLiveFeed, modelState]
  );

  // Chargement des matchs pour un jour donné (-1 = Hier, 0 = Aujourd'hui, 1 = Demain)
  const loadDayMatches = useCallback(
    async (offset, cfgOverride = null) => {
      setLoadingLive(true);
      try {
        const feed = await fetchScheduleForOffset(offset, cfgOverride || apiCfg);
        setRawLiveFeed(feed);
      } catch {
        // ignore
      }
      setLoadingLive(false);
    },
    [apiCfg]
  );

  // Ingérer automatiquement les vrais matchs terminés (Hier + Aujourd'hui) pour apprentissage continu !
  const ingestFinishedMatches = useCallback(
    async (silent = false) => {
      const [yest, today] = await Promise.all([
        fetchScheduleForOffset(-1, apiCfg),
        fetchScheduleForOffset(0, apiCfg),
      ]);
      const completedReal = [...yest.matches, ...today.matches].filter(
        (m) => m.completed && typeof m.scoreHome === "number" && typeof m.scoreAway === "number"
      );

      if (completedReal.length === 0) {
        if (!silent) {
          triggerToast("ℹ️ Aucun nouveau match terminé détecté pour l'instant.");
        }
        return;
      }

      setPredictions((prev) => {
        const knownExt = new Set(learnedExternalIds);
        let updatedList = [...prev];
        let addedCount = 0;
        let autoValidatedCount = 0;

        for (const m of completedReal) {
          const outcome = m.scoreHome > m.scoreAway ? 0 : m.scoreHome === m.scoreAway ? 1 : 2;

          // 1. Valider automatiquement tout match en attente correspondant dans l'Historique de l'utilisateur
          updatedList = updatedList.map((existing) => {
            if (
              !isValidated(existing) &&
              normalizeKey(existing.home) === normalizeKey(m.home) &&
              normalizeKey(existing.away) === normalizeKey(m.away)
            ) {
              autoValidatedCount += 1;
              return {
                ...existing,
                result: outcome,
                scoreHome: m.scoreHome,
                scoreAway: m.scoreAway,
              };
            }
            return existing;
          });

          // 2. Intégrer les autres matchs réels terminés dans la mémoire d'apprentissage continu
          if (!knownExt.has(m.externalId)) {
            knownExt.add(m.externalId);
            const curState = rebuildModelState(updatedList, { optaOverrides, evolvedHyper });
            const pred = computeFullPrediction(m.home, m.away, m.league, curState, m.liveOdds);
            updatedList = [
              {
                id: Date.now() + addedCount * 10 + Math.floor(Math.random() * 9),
                externalId: m.externalId,
                autoLearned: true,
                home: pred.home,
                away: pred.away,
                league: m.league,
                probs: pred.probs,
                rawProbs: pred.rawProbs,
                fairOdds: pred.fairOdds,
                xg: pred.xg,
                selectedMarket: {
                  ...pred.recommendedMarket,
                  bookOdd: pred.recommendedMarket.marketOdd,
                },
                date: m.dateFr || new Date().toLocaleDateString("fr-FR"),
                result: outcome,
                scoreHome: m.scoreHome,
                scoreAway: m.scoreAway,
              },
              ...updatedList,
            ];
            addedCount += 1;
          }
        }

        if (addedCount > 0 || autoValidatedCount > 0) {
          setLearnedExternalIds(Array.from(knownExt));
          // Déclencher automatiquement un cycle d'évolution multi-époques !
          const evolved = runContinuousEvolution(updatedList, evolvedHyper || {}, optaOverrides);
          setEvolvedHyper(evolved.evolvedHyper);
          triggerToast(
            `🧬 Auto-Apprentissage Continu : +${addedCount + autoValidatedCount} vrais résultats appris (Génération #${evolved.evolvedHyper.generation}) !`
          );
        } else if (!silent) {
          triggerToast("✓ Mémoire IA déjà synchronisée avec tous les derniers résultats réels !");
        }

        return updatedList;
      });
    },
    [apiCfg, learnedExternalIds, optaOverrides, evolvedHyper, triggerToast]
  );

  // Au démarrage de l'application : charger Aujourd'hui + auto-apprendre les résultats récents
  useEffect(() => {
    loadDayMatches(0);
    if (apiCfg.autoLearnResults !== false) {
      ingestFinishedMatches(true);
    }
  }, []);

  const leagueClubs = useMemo(() => getClubsForLeague(form.league), [form.league]);

  // Prédiction temps réel pour le match actif (intégrant le signal Vidéo IA s'il est actif !)
  const livePrediction = useMemo(() => {
    if (!activeMatch.home.trim() || !activeMatch.away.trim()) return null;
    if (normalizeKey(activeMatch.home) === normalizeKey(activeMatch.away)) return null;
    return computeFullPrediction(
      activeMatch.home,
      activeMatch.away,
      activeMatch.league,
      modelState,
      bookOdds,
      { videoBoost: videoInsight, matchContext }
    );
  }, [activeMatch, modelState, bookOdds, videoInsight, matchContext]);

  useEffect(() => {
    if (livePrediction) {
      setSelectedMarketCode(livePrediction.recommendedMarket.code);
    }
  }, [livePrediction?.home, livePrediction?.away, livePrediction?.league]);

  const currentPickedMarket = useMemo(() => {
    if (!livePrediction) return null;
    return (
      livePrediction.markets.find((m) => m.code === selectedMarketCode) ||
      livePrediction.recommendedMarket
    );
  }, [livePrediction, selectedMarketCode]);

  const expertNarrative = useMemo(() => {
    if (!livePrediction) return "";
    return generateExpertAnalysis(livePrediction, modelState, videoInsight);
  }, [livePrediction, modelState, videoInsight]);

  const handleAnalyzeSubmit = (e) => {
    if (e) e.preventDefault();
    if (!form.home.trim() || !form.away.trim()) {
      triggerToast("Veuillez renseigner les deux équipes.");
      return;
    }
    if (normalizeKey(form.home) === normalizeKey(form.away)) {
      triggerToast("Veuillez choisir deux équipes différentes.");
      return;
    }
    setActiveMatch({
      home: form.home.trim(),
      away: form.away.trim(),
      league: form.league,
    });
    setShowAnalysis(true);
  };

  const handleQuickFixture = (home, away) => {
    setForm((f) => ({ ...f, home, away }));
    setBookOdds({ odd1: "", oddN: "", odd2: "" });
    setActiveMatch({ home, away, league: form.league });
    setShowAnalysis(true);
  };

  const handleSwapTeams = () => {
    setForm((f) => {
      const next = { ...f, home: f.away, away: f.home };
      if (next.home.trim() && next.away.trim()) {
        setActiveMatch(next);
      }
      return next;
    });
    setBookOdds((o) => ({ odd1: o.odd2, oddN: o.oddN, odd2: o.odd1 }));
  };

  const buildPredictionRecord = () => {
    if (!livePrediction || !currentPickedMarket) return null;
    const customOddMap = {
      "1": parseFloat(bookOdds.odd1),
      N: parseFloat(bookOdds.oddN),
      "2": parseFloat(bookOdds.odd2),
    };
    const chosenOdd =
      !Number.isNaN(customOddMap[currentPickedMarket.code]) &&
      customOddMap[currentPickedMarket.code] > 1.01
        ? customOddMap[currentPickedMarket.code]
        : currentPickedMarket.marketOdd;

    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      home: livePrediction.home,
      away: livePrediction.away,
      league: livePrediction.league,
      probs: livePrediction.probs,
      rawProbs: livePrediction.rawProbs,
      fairOdds: livePrediction.fairOdds,
      xg: livePrediction.xg,
      selectedMarket: {
        ...currentPickedMarket,
        bookOdd: chosenOdd,
      },
      date: new Date().toLocaleDateString("fr-FR"),
      result: undefined,
    };
  };

  const handleAddToCouponAndHistory = () => {
    const rec = buildPredictionRecord();
    if (!rec) return;
    setPredictions((prev) => [rec, ...prev]);
    setCoupon((prev) => [...prev, rec]);
    triggerToast(`✓ "${rec.home} vs ${rec.away}" ajouté au Coupon (${rec.selectedMarket.label})`);
    setTab("coupon");
  };

  const handleQuickAddLiveMatchCoupon = (liveMatch) => {
    const pred = liveMatch.prediction;
    const rec = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      externalId: liveMatch.externalId,
      home: pred.home,
      away: pred.away,
      league: liveMatch.league,
      probs: pred.probs,
      rawProbs: pred.rawProbs,
      fairOdds: pred.fairOdds,
      xg: pred.xg,
      selectedMarket: {
        ...pred.recommendedMarket,
        bookOdd: pred.recommendedMarket.marketOdd,
      },
      date: liveMatch.dateFr || new Date().toLocaleDateString("fr-FR"),
      result: undefined,
    };
    setPredictions((prev) => [rec, ...prev]);
    setCoupon((prev) => [...prev, rec]);
    triggerToast(`🎰 "${pred.home} vs ${pred.away}" ajouté au Coupon !`);
  };

  const handleInspectLiveMatch = (liveMatch) => {
    setForm({ home: liveMatch.home, away: liveMatch.away, league: liveMatch.league });
    setBookOdds(liveMatch.liveOdds || { odd1: "", oddN: "", odd2: "" });
    if (liveMatch.liveOdds) setShowOddsInput(true);
    setActiveMatch({ home: liveMatch.home, away: liveMatch.away, league: liveMatch.league });
    setTab("predict");
  };

  const handleSaveHistoryOnly = () => {
    const rec = buildPredictionRecord();
    if (!rec) return;
    setPredictions((prev) => [rec, ...prev]);
    triggerToast("📥 Match enregistré dans l'Historique d'apprentissage");
  };

  const handleValidateMatch = useCallback(
    (id, result, scoreHome, scoreAway) => {
      const updateItem = (item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          result,
          scoreHome: typeof scoreHome === "number" ? scoreHome : item.scoreHome,
          scoreAway: typeof scoreAway === "number" ? scoreAway : item.scoreAway,
        };
      };
      setPredictions((prev) => {
        const next = prev.map(updateItem);
        const evolved = runContinuousEvolution(next, evolvedHyper || {}, optaOverrides);
        setEvolvedHyper(evolved.evolvedHyper);
        return next;
      });
      setCoupon((prev) => prev.map(updateItem));
      triggerToast("🧬 Erreur/Succès analysé — Modèle IA recalibré automatiquement !");
    },
    [evolvedHyper, optaOverrides, triggerToast]
  );

  const handleManualSelfEvolution = () => {
    if (modelState.metrics.total === 0) {
      handleRunCalibration();
      return;
    }
    const res = runContinuousEvolution(predictions, modelState.hyper, optaOverrides);
    setEvolvedHyper(res.evolvedHyper);
    triggerToast(
      `🧬 Génération #${res.evolvedHyper.generation} optimisée — Brier Score : ${res.afterBrier.toFixed(3)} !`
    );
  };

  const handleDeleteMatch = useCallback((id) => {
    setPredictions((prev) => prev.filter((p) => p.id !== id));
    setCoupon((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleUpdateCouponOdd = (id, rawVal) => {
    const parsed = parseFloat(rawVal);
    setCoupon((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              selectedMarket: {
                ...item.selectedMarket,
                bookOdd: Number.isNaN(parsed) || parsed < 1.01 ? item.selectedMarket.bookOdd : parsed,
                rawOddInput: rawVal,
              },
            }
          : item
      )
    );
  };

  const handleRunCalibration = () => {
    let runningList = [...predictions];
    const baseTime = Date.now() - CALIBRATION_MATCHES.length * 60000;

    CALIBRATION_MATCHES.forEach((m, idx) => {
      const tempState = rebuildModelState(runningList, { optaOverrides, evolvedHyper });
      const pred = computeFullPrediction(m.home, m.away, m.league, tempState);
      const outcome = m.scoreHome > m.scoreAway ? 0 : m.scoreHome === m.scoreAway ? 1 : 2;
      const entry = {
        id: baseTime + idx * 1000,
        home: pred.home,
        away: pred.away,
        league: m.league,
        probs: pred.probs,
        rawProbs: pred.rawProbs,
        fairOdds: pred.fairOdds,
        xg: pred.xg,
        selectedMarket: {
          ...pred.recommendedMarket,
          bookOdd: pred.recommendedMarket.marketOdd,
        },
        date: m.date,
        result: outcome,
        scoreHome: m.scoreHome,
        scoreAway: m.scoreAway,
      };
      runningList = [entry, ...runningList];
    });

    const evolved = runContinuousEvolution(runningList, evolvedHyper || {}, optaOverrides);
    setEvolvedHyper(evolved.evolvedHyper);
    setPredictions(runningList);
    triggerToast(
      `⚡ ${CALIBRATION_MATCHES.length} matchs intégrés & auto-calibrés (Génération #${evolved.evolvedHyper.generation}) !`
    );
  };

  const handleExportJSON = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 3,
            exportedAt: new Date().toISOString(),
            predictions,
            coupon,
            optaOverrides,
            evolvedHyper,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `football-ai-ultra-v3-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast("📤 Sauvegarde complète v3 téléchargée !");
  };

  const handleImportJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed.predictions)) {
          setPredictions(parsed.predictions);
          if (Array.isArray(parsed.coupon)) setCoupon(parsed.coupon);
          if (parsed.optaOverrides) setOptaOverrides(parsed.optaOverrides);
          if (parsed.evolvedHyper) setEvolvedHyper(parsed.evolvedHyper);
          triggerToast(`📥 ${parsed.predictions.length} prédictions restaurées avec succès !`);
        }
      } catch {
        triggerToast("Fichier JSON invalide.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleConfirmedReset = () => {
    setPredictions([]);
    setCoupon([]);
    setOptaOverrides({});
    setEvolvedHyper(null);
    setLearnedExternalIds([]);
    setConfirmReset(false);
    triggerToast("🗑️ Mémoire IA réinitialisée.");
  };

  const handleShareCoupon = async () => {
    if (coupon.length === 0 || !couponSummary) return;
    const lines = [
      `⚡ COUPON FOOTBALL AI ULTRA (${coupon.length} match${coupon.length > 1 ? "s" : ""})`,
      "────────────────────────",
      ...coupon.map(
        (c, idx) =>
          `${idx + 1}. ${c.home} vs ${c.away} → ${c.selectedMarket?.label} (${c.selectedMarket?.pct}% | Cote ${Number(c.selectedMarket?.bookOdd || 1.5).toFixed(2)})`
      ),
      "────────────────────────",
      `📊 Cote totale : ${couponSummary.combinedBookOdd.toFixed(2)} | Probabilité IA : ${couponSummary.combinedProbPct}%`,
      `💰 Mise : ${formatMoney(stake, currency)} → Gain potentiel : ${formatMoney(couponSummary.potentialPayout, currency)}`,
    ];
    const text = lines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: "Mon Coupon Football AI Ultra", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      triggerToast("📋 Coupon copié dans le presse-papiers (prêt pour WhatsApp / Telegram) !");
    } catch {
      triggerToast("📋 Résumé prêt à être partagé.");
    }
  };

  const handlePushCloud = async () => {
    setCloudBusy(true);
    saveFirebaseSyncConfig(cloudCfg);
    try {
      await pushStateToFirebase(cloudCfg.databaseUrl, cloudCfg.syncRoom, {
        predictions,
        coupon,
        stake,
        currency,
        optaOverrides,
        evolvedHyper,
      });
      triggerToast("☁️ Mémoire v3 & Coupon sauvegardés sur Firebase Cloud !");
    } catch (err) {
      triggerToast(`⚠️ ${err.message}`);
    }
    setCloudBusy(false);
  };

  const handlePullCloud = async () => {
    setCloudBusy(true);
    saveFirebaseSyncConfig(cloudCfg);
    try {
      const data = await pullStateFromFirebase(cloudCfg.databaseUrl, cloudCfg.syncRoom);
      setPredictions(data.predictions);
      if (Array.isArray(data.coupon)) setCoupon(data.coupon);
      if (typeof data.stake === "number") setStake(data.stake);
      if (data.currency) setCurrency(data.currency);
      if (data.optaOverrides) setOptaOverrides(data.optaOverrides);
      if (data.evolvedHyper) setEvolvedHyper(data.evolvedHyper);
      triggerToast(`☁️ ${data.predictions.length} prédictions restaurées depuis Firebase !`);
    } catch (err) {
      triggerToast(`⚠️ ${err.message}`);
    }
    setCloudBusy(false);
  };

  const couponSummary = useMemo(() => {
    if (coupon.length === 0) return null;
    let combinedProb = 1;
    let combinedBookOdd = 1;
    let weakestLeg = coupon[0];

    for (const item of coupon) {
      const legProb = item.selectedMarket?.prob ?? Math.max(...item.rawProbs);
      const legOdd = item.selectedMarket?.bookOdd ?? 1.5;
      combinedProb *= legProb;
      combinedBookOdd *= legOdd;
      const weakestProb = weakestLeg.selectedMarket?.prob ?? Math.max(...weakestLeg.rawProbs);
      if (legProb < weakestProb) {
        weakestLeg = item;
      }
    }

    const fairCombinedOdd = 1 / Math.max(combinedProb, 0.0001);
    const potentialPayout = stake * combinedBookOdd;
    const netProfit = potentialPayout - stake;
    const evPct = Math.round((combinedProb * combinedBookOdd - 1) * 1000) / 10;

    let riskLabel = "Faible (Ticket Solide)";
    let riskColor = "#00e676";
    if (combinedProb < 0.15) {
      riskLabel = "Très élevé (Loterie)";
      riskColor = "#ff3d5a";
    } else if (combinedProb < 0.32) {
      riskLabel = "Élevé (Audacieux)";
      riskColor = "#ff9100";
    } else if (combinedProb < 0.52) {
      riskLabel = "Modéré (Équilibré)";
      riskColor = "#ffea00";
    }

    return {
      combinedProbPct: Math.round(combinedProb * 1000) / 10,
      combinedBookOdd: Math.round(combinedBookOdd * 100) / 100,
      fairCombinedOdd: Math.round(fairCombinedOdd * 100) / 100,
      potentialPayout,
      netProfit,
      evPct,
      weakestLeg,
      riskLabel,
      riskColor,
    };
  }, [coupon, stake]);

  const filteredHistory = useMemo(() => {
    const q = normalizeKey(historySearch);
    return predictions.filter((p) => {
      if (q) {
        const matchText = `${normalizeKey(p.home)} ${normalizeKey(p.away)} ${normalizeKey(LEAGUES[p.league]?.name)}`;
        if (!matchText.includes(q)) return false;
      }
      const val = isValidated(p);
      if (historyFilter === "pending") return !val;
      if (historyFilter === "correct") {
        return val && p.result === p.probs.indexOf(Math.max(...p.probs));
      }
      if (historyFilter === "wrong") {
        return val && p.result !== p.probs.indexOf(Math.max(...p.probs));
      }
      return true;
    });
  }, [predictions, historyFilter, historySearch]);

  const learnedTeamsList = useMemo(
    () =>
      Object.values(modelState.teams)
        .filter((t) => t.games > 0)
        .sort((a, b) => b.elo - a.elo),
    [modelState.teams]
  );

  const homeClubPreview = useMemo(() => {
    const key = normalizeKey(canonicalTeamName(form.home));
    return modelState.teams[key] || resolveClub(form.home);
  }, [form.home, modelState.teams]);

  const awayClubPreview = useMemo(() => {
    const key = normalizeKey(canonicalTeamName(form.away));
    return modelState.teams[key] || resolveClub(form.away);
  }, [form.away, modelState.teams]);

  const acc = modelState.metrics.accuracyPct;
  const genNumber = modelState.hyper.learningGeneration || 1;

  const tabs = [
    { id: "live", label: `📅 Matchs du Jour (${enrichedLiveFeed.matches.length})` },
    { id: "predict", label: "🎯 Prédire" },
    { id: "inplay", label: "🔴 Live In-Play" },
    { id: "h2h", label: "⚔️ Face-à-Face" },
    { id: "video", label: videoInsight ? "🎥 Vidéo IA ✓" : "🎥 Vidéo IA" },
    { id: "fantasy", label: "🏆 Fantasy IA" },
    { id: "cloe", label: "🤖 Cloé IA" },
    { id: "coupon", label: `🎰 Coupon (${coupon.length})` },
    { id: "history", label: `📊 Historique (${predictions.length})` },
    { id: "stats", label: `🧠 Mémoire Gen #${genNumber}` },
  ];

  return (
    <div className="fai-app">
      <datalist id="football-ai-clubs">
        {leagueClubs.map((c) => (
          <option key={c.name} value={c.name}>
            {c.fullName} — Elo {c.elo}
          </option>
        ))}
        {CLUBS_DB.filter((c) => !c.leagues.includes(form.league)).map((c) => (
          <option key={`all-${c.name}`} value={c.name}>
            {c.fullName}
          </option>
        ))}
      </datalist>

      {/* ====== HEADER COLLANT ====== */}
      <header className="fai-header">
        <div className="fai-container">
          <div className="fai-header-top">
            <div>
              <div className="fai-brand-title">
                <span className="fai-gradient-text">⚡ FOOTBALL AI</span>
                <span className="fai-badge-version">
                  ULTRA v3 • GEN #{genNumber} AUTO-ÉVOLUTIVE
                </span>
              </div>
              <div className="fai-brand-sub">
                Matchs Live • Vision Vidéo IA • H2H Monte-Carlo • Fantasy 100M€ • Apprentissage Continu
              </div>
            </div>

            <div className="fai-header-kpis">
              {installPromptEvent && (
                <button
                  type="button"
                  className="fai-btn-secondary"
                  onClick={handleInstallPWA}
                >
                  📲 Installer l&apos;App
                </button>
              )}
              {acc !== null ? (
                <>
                  <div className="fai-kpi-pill">
                    <div
                      className="fai-kpi-val"
                      style={{
                        color: acc >= 60 ? "#00e676" : acc >= 48 ? "#ffea00" : "#ff3d5a",
                      }}
                    >
                      {acc}%
                    </div>
                    <div className="fai-kpi-lbl">
                      1X2 ({modelState.metrics.total} appris)
                    </div>
                  </div>
                  <div className="fai-kpi-pill">
                    <div className="fai-kpi-val" style={{ color: "#00e5ff" }}>
                      {modelState.metrics.marketAccuracyPct}%
                    </div>
                    <div className="fai-kpi-lbl">Options Coupon</div>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="fai-btn-secondary"
                  onClick={handleRunCalibration}
                >
                  ⚡ Calibrer l&apos;IA (24 matchs)
                </button>
              )}
            </div>
          </div>

          <nav className="fai-tabs" aria-label="Navigation principale">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fai-tab-btn ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="fai-main">
        {/* ======================================================
            ONGLET LIVE : MATCHS D'AUJOURD'HUI, DEMAIN & API / OPTA
           ====================================================== */}
        {tab === "live" && (
          <LiveMatchesTab
            dayOffset={dayOffset}
            onChangeDayOffset={(off) => {
              setDayOffset(off);
              loadDayMatches(off);
            }}
            liveFeed={enrichedLiveFeed}
            loadingLive={loadingLive}
            onRefreshLive={loadDayMatches}
            onAutoLearnCompleted={() => ingestFinishedMatches(false)}
            onInspectMatch={handleInspectLiveMatch}
            onQuickAddCoupon={handleQuickAddLiveMatchCoupon}
            onOpenInPlay={(m) => {
              setActiveMatch({ home: m.home, away: m.away, league: m.league || "ucl" });
              setTab("inplay");
            }}
            apiCfg={apiCfg}
            onSaveApiCfg={(next) => {
              setApiCfg(next);
              saveExternalApiConfig(next);
            }}
            onApplyOptaOverrides={(overrides, count) => {
              setOptaOverrides((prev) => ({ ...prev, ...overrides }));
              triggerToast(`📊 ${count} profils Opta xG intégrés à la mémoire IA !`);
            }}
          />
        )}

        {/* ======================================================
            ONGLET PRÉDIRE & ANALYSER
           ====================================================== */}
        {tab === "predict" && (
          <div>
            <form className="fai-panel" onSubmit={handleAnalyzeSubmit}>
              <div className="fai-section-title">
                <span>⚙️ Configuration de la rencontre</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {videoInsight && (
                    <span style={{ color: "#00e676", fontSize: 11 }}>
                      🎥 Signal Vidéo IA actif (×{videoInsight.homeXgMult} / ×{videoInsight.awayXgMult})
                    </span>
                  )}
                  <span style={{ color: "#7f89b2", fontFamily: "var(--font-mono)" }}>
                    {CLUBS_DB.length} équipes calibrées
                  </span>
                </div>
              </div>

              <div className="fai-league-grid">
                {Object.entries(LEAGUES).map(([key, lg]) => (
                  <button
                    key={key}
                    type="button"
                    className={`fai-league-pill ${form.league === key ? "selected" : ""}`}
                    onClick={() => {
                      const defaultPair = lg.featuredMatches[0];
                      setForm({ league: key, home: defaultPair[0], away: defaultPair[1] });
                      setActiveMatch({ league: key, home: defaultPair[0], away: defaultPair[1] });
                    }}
                  >
                    {lg.name}
                  </button>
                ))}
              </div>

              <div className="fai-quick-matches">
                <span style={{ fontSize: 11, color: "#68729b", textTransform: "uppercase", letterSpacing: 1 }}>
                  Affiches rapides :
                </span>
                {(LEAGUES[form.league]?.featuredMatches || []).map(([h, a]) => (
                  <button
                    key={`${h}-${a}`}
                    type="button"
                    className="fai-quick-chip"
                    onClick={() => handleQuickFixture(h, a)}
                  >
                    {h} vs {a}
                  </button>
                ))}
              </div>

              <div className="fai-teams-row">
                <div>
                  <label className="fai-label" htmlFor="input-home">
                    🏠 Équipe Domicile
                  </label>
                  <input
                    id="input-home"
                    list="football-ai-clubs"
                    className="fai-input"
                    value={form.home}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((f) => ({ ...f, home: val }));
                      if (val.trim() && form.away.trim()) {
                        setActiveMatch({ home: val, away: form.away, league: form.league });
                      }
                    }}
                    placeholder="Ex: PSG, Liverpool, Real Madrid..."
                  />
                  <div className="fai-club-hint">
                    {homeClubPreview ? (
                      <>
                        <span style={{ color: "#00e5ff" }}>Elo {Math.round(homeClubPreview.elo)}</span>
                        <span>
                          Atk ×{homeClubPreview.atk.toFixed(2)} • Déf ×{homeClubPreview.def.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      <span>Club personnalisé • Elo standard 1690</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="fai-swap-btn"
                  onClick={handleSwapTeams}
                  title="Inverser Domicile et Extérieur"
                >
                  ⇄
                </button>

                <div>
                  <label className="fai-label" htmlFor="input-away">
                    ✈️ Équipe Extérieur
                  </label>
                  <input
                    id="input-away"
                    list="football-ai-clubs"
                    className="fai-input"
                    value={form.away}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((f) => ({ ...f, away: val }));
                      if (form.home.trim() && val.trim()) {
                        setActiveMatch({ home: form.home, away: val, league: form.league });
                      }
                    }}
                    placeholder="Ex: Marseille, Arsenal, FC Barcelone..."
                  />
                  <div className="fai-club-hint">
                    {awayClubPreview ? (
                      <>
                        <span style={{ color: "#9d7bff" }}>Elo {Math.round(awayClubPreview.elo)}</span>
                        <span>
                          Atk ×{awayClubPreview.atk.toFixed(2)} • Déf ×{awayClubPreview.def.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      <span>Club personnalisé • Elo standard 1690</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="fai-odds-box">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                  onClick={() => setShowOddsInput((v) => !v)}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#cbd2f5" }}>
                    💰 Scanner de Cotes Bookmaker — Détecteur Value Bet &amp; Critère de Kelly
                  </span>
                  <span style={{ fontSize: 12, color: "#00e5ff", fontWeight: 700 }}>
                    {showOddsInput ? "Masquer ▲" : "Saisir les cotes ▼"}
                  </span>
                </div>

                {showOddsInput && (
                  <div className="fai-odds-grid">
                    {[
                      ["odd1", `Cote 1 (${form.home || "Dom."})`],
                      ["oddN", "Cote N (Match Nul)"],
                      ["odd2", `Cote 2 (${form.away || "Ext."})`],
                    ].map(([field, lbl]) => (
                      <div key={field}>
                        <label className="fai-label" style={{ fontSize: 10 }}>
                          {lbl}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="1.01"
                          className="fai-input"
                          style={{ padding: "8px 10px" }}
                          placeholder="Ex: 1.85"
                          value={bookOdds[field]}
                          onChange={(e) =>
                            setBookOdds((prev) => ({ ...prev, [field]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* PANNEAU ABSENCES STARS, FATIGUE (<72H) & ENJEU TACTIQUE */}
              <div className="fai-odds-box" style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                  onClick={() => setShowContextBox((v) => !v)}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#cbd2f5" }}>
                    🏥 Absences Stars, Fatigue (&lt;72h) &amp; Enjeu Tactique{" "}
                    {matchContext.absentHomeIds.length + matchContext.absentAwayIds.length > 0 && (
                      <span style={{ color: "#ff5252" }}>
                        • {matchContext.absentHomeIds.length + matchContext.absentAwayIds.length} absent(s) actif(s)
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 12, color: "#00e676", fontWeight: 700 }}>
                    {showContextBox ? "Masquer ▲" : "Configurer ▼"}
                  </span>
                </div>

                {showContextBox && (
                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 10,
                      }}
                    >
                      {[
                        { side: "absentHomeIds", team: form.home || "Domicile", fatKey: "fatigueHome" },
                        { side: "absentAwayIds", team: form.away || "Extérieur", fatKey: "fatigueAway" },
                      ].map(({ side, team, fatKey }) => {
                        const stars = getSquadStarsForTeam(team);
                        const selectedIds = matchContext[side];
                        return (
                          <div
                            key={side}
                            style={{
                              background: "rgba(6,8,24,0.65)",
                              border: "1px solid rgba(255,255,255,0.08)",
                              borderRadius: 10,
                              padding: 10,
                            }}
                          >
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#00e5ff", marginBottom: 6 }}>
                              🚑 Absents / Blessés — {team}
                            </div>
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                              {stars.map((pl) => {
                                const isOut = selectedIds.includes(pl.id);
                                return (
                                  <button
                                    key={pl.id}
                                    type="button"
                                    onClick={() =>
                                      setMatchContext((prev) => ({
                                        ...prev,
                                        [side]: isOut
                                          ? prev[side].filter((id) => id !== pl.id)
                                          : [...prev[side], pl.id],
                                      }))
                                    }
                                    style={{
                                      background: isOut ? "rgba(255,61,113,0.28)" : "rgba(255,255,255,0.05)",
                                      border: `1px solid ${isOut ? "#ff3d71" : "rgba(255,255,255,0.14)"}`,
                                      color: isOut ? "#ff85a2" : "#cbd5e1",
                                      borderRadius: 999,
                                      padding: "4px 9px",
                                      fontSize: 11,
                                      fontWeight: 700,
                                      cursor: "pointer",
                                      textDecoration: isOut ? "line-through" : "none",
                                    }}
                                  >
                                    {isOut ? "✖ " : ""}
                                    {pl.name} ({pl.pos})
                                  </button>
                                );
                              })}
                            </div>
                            <select
                              className="fai-input"
                              style={{ fontSize: 11.5, padding: "6px 8px" }}
                              value={matchContext[fatKey]}
                              onChange={(e) =>
                                setMatchContext((prev) => ({ ...prev, [fatKey]: e.target.value }))
                              }
                            >
                              {FATIGUE_OPTIONS.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select
                        className="fai-input"
                        style={{ flex: 1, fontSize: 12, padding: "8px 10px" }}
                        value={matchContext.stakes}
                        onChange={(e) =>
                          setMatchContext((prev) => ({ ...prev, stakes: e.target.value }))
                        }
                      >
                        {STAKES_OPTIONS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="fai-btn-ghost"
                        onClick={() =>
                          setMatchContext({
                            absentHomeIds: [],
                            absentAwayIds: [],
                            fatigueHome: "fresh",
                            fatigueAway: "fresh",
                            stakes: "standard",
                          })
                        }
                      >
                        Réinitialiser contexte
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="submit"
                  className="fai-btn-primary"
                  style={{ flex: "2 1 260px" }}
                  disabled={
                    !form.home.trim() ||
                    !form.away.trim() ||
                    normalizeKey(form.home) === normalizeKey(form.away)
                  }
                >
                  ⚡ Calculer la Prédiction &amp; l&apos;Analyse Tactique IA
                </button>
                <button
                  type="button"
                  className="fai-btn-secondary"
                  style={{ flex: "1 1 180px" }}
                  onClick={() => setTab("video")}
                >
                  🎥 Enrichir par Vidéo IA
                </button>
              </div>
            </form>

            {livePrediction && (
              <div className="fai-panel">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 16,
                    flexWrap: "wrap",
                    paddingBottom: 18,
                    marginBottom: 20,
                    borderBottom: "1px solid var(--border-muted)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: LEAGUES[livePrediction.league]?.color || "#00e5ff",
                        textTransform: "uppercase",
                        letterSpacing: 2,
                      }}
                    >
                      {LEAGUES[livePrediction.league]?.name}
                    </div>
                    <h2 style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>
                      {livePrediction.home}{" "}
                      <span style={{ color: "#5e6790", fontWeight: 600 }}>vs</span>{" "}
                      {livePrediction.away}
                    </h2>
                    <div
                      style={{
                        display: "flex",
                        gap: 16,
                        flexWrap: "wrap",
                        marginTop: 8,
                        fontSize: 12,
                        color: "#9aa3c7",
                      }}
                    >
                      <span>
                        🏠 {livePrediction.home} :{" "}
                        <FormBadges form={livePrediction.elo.homeForm} />
                      </span>
                      <span>
                        ✈️ {livePrediction.away} :{" "}
                        <FormBadges form={livePrediction.elo.awayForm} />
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        background: "#080a1a",
                        border: "1px solid var(--border-muted)",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 10, color: "#7f89b2", textTransform: "uppercase", letterSpacing: 1 }}>
                        Expected Goals (xG)
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 18,
                          fontWeight: 800,
                          color: "#00e5ff",
                          marginTop: 2,
                        }}
                      >
                        {livePrediction.xg.home.toFixed(2)}{" "}
                        <span style={{ color: "#58608a" }}>-</span>{" "}
                        {livePrediction.xg.away.toFixed(2)}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        background: "#080a1a",
                        border: `1px solid ${livePrediction.confidence.color}55`,
                        textAlign: "right",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: livePrediction.confidence.color,
                          textTransform: "uppercase",
                        }}
                      >
                        Fiabilité {livePrediction.confidence.score}/100 •{" "}
                        {livePrediction.confidence.label}
                      </div>
                      <Stars count={livePrediction.confidence.stars} />
                    </div>
                  </div>
                </div>

                <div className="fai-grid-2">
                  <div>
                    <div className="fai-section-title">
                      <span>📊 Probabilités Hybrides 1X2 (Somme exacte 100%)</span>
                      <span style={{ color: "#7f89b2", fontFamily: "var(--font-mono)" }}>
                        {livePrediction.modelsBreakdown.dcWeightPct}% Poisson /{" "}
                        {100 - livePrediction.modelsBreakdown.dcWeightPct}% Elo
                      </span>
                    </div>

                    {livePrediction.probs.map((pct, idx) => {
                      const maxIdx = livePrediction.probs.indexOf(
                        Math.max(...livePrediction.probs)
                      );
                      return (
                        <ProbBar
                          key={idx}
                          label={
                            idx === 0
                              ? `1 • Victoire ${livePrediction.home}`
                              : idx === 1
                                ? "N • Match Nul"
                                : `2 • Victoire ${livePrediction.away}`
                          }
                          value={pct}
                          fairOdd={livePrediction.fairOdds[idx]}
                          subInfo={`DC ${livePrediction.modelsBreakdown.dixonColes[idx]}% | Elo ${livePrediction.modelsBreakdown.eloLogit[idx]}%`}
                          color={livePrediction.confidence.color}
                          isWinner={idx === maxIdx}
                          valueItem={livePrediction.valueAnalysis?.items?.[idx]}
                        />
                      );
                    })}

                    {livePrediction.valueAnalysis && (
                      <div
                        style={{
                          marginTop: 14,
                          padding: 12,
                          borderRadius: 10,
                          background: livePrediction.valueAnalysis.bestValue?.isValue
                            ? "rgba(0, 230, 118, 0.09)"
                            : "rgba(255, 255, 255, 0.03)",
                          border: `1px solid ${
                            livePrediction.valueAnalysis.bestValue?.isValue
                              ? "#00e676"
                              : "var(--border-muted)"
                          }`,
                          fontSize: 12,
                        }}
                      >
                        {livePrediction.valueAnalysis.bestValue?.isValue ? (
                          <div>
                            <strong style={{ color: "#00e676" }}>
                              💎 VALUE BET DÉTECTÉ : {livePrediction.valueAnalysis.bestValue.label}
                            </strong>{" "}
                            à la cote <strong>{livePrediction.valueAnalysis.bestValue.bookOdd}</strong>{" "}
                            (Espérance <strong>+{livePrediction.valueAnalysis.bestValue.evPct}%</strong> •
                            Mise Kelly ¼ :{" "}
                            <strong>{livePrediction.valueAnalysis.bestValue.kellyPct}%</strong>).
                          </div>
                        ) : (
                          <div style={{ color: "#9aa3c7" }}>
                            Aucune value mathématique nette (&ge; +3%) détectée sur ces cotes.
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ marginTop: 18 }}>
                      <div className="fai-section-title">
                        <span>🎯 Top 6 Scores Exacts Probables</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {livePrediction.topScores.map((sc, i) => (
                          <div
                            key={sc.score}
                            style={{
                              flex: "1 1 82px",
                              padding: "8px 10px",
                              borderRadius: 10,
                              background: i === 0 ? "rgba(0, 229, 255, 0.14)" : "#080a1a",
                              border: `1px solid ${
                                i === 0 ? "rgba(0, 229, 255, 0.55)" : "var(--border-muted)"
                              }`,
                              textAlign: "center",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>
                              {sc.score}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: i === 0 ? "#00e5ff" : "#8e98c2",
                                marginTop: 2,
                              }}
                            >
                              {sc.pct}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="fai-section-title">
                      <span>🧮 Matrice Poisson Dixon-Coles (5×5)</span>
                    </div>
                    <ScoreHeatmap
                      heatmap={livePrediction.heatmap5x5}
                      homeName={livePrediction.home}
                      awayName={livePrediction.away}
                    />

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                        marginTop: 14,
                      }}
                    >
                      {[
                        ["+1.5 Buts", `${livePrediction.goals.over15Pct}%`],
                        ["+2.5 Buts", `${livePrediction.goals.over25Pct}%`],
                        ["-2.5 Buts", `${livePrediction.goals.under25Pct}%`],
                        ["BTTS (Les 2 marquent)", `${livePrediction.goals.bttsYesPct}%`],
                      ].map(([lbl, val]) => (
                        <div
                          key={lbl}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 9,
                            background: "#080a1a",
                            border: "1px solid var(--border-muted)",
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                          }}
                        >
                          <span style={{ color: "#9aa3c7" }}>{lbl}</span>
                          <strong style={{ fontFamily: "var(--font-mono)", color: "#fff" }}>
                            {val}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 22 }}>
                  <div className="fai-section-title">
                    <span>🎰 Choisissez le Marché à ajouter au Coupon</span>
                    <span style={{ color: "#00e676" }}>
                      ★ Recommandation IA : {livePrediction.recommendedMarket.label} (
                      {livePrediction.recommendedMarket.pct}%)
                    </span>
                  </div>
                  <div className="fai-markets-grid">
                    {livePrediction.markets.map((m) => {
                      const isSelected = currentPickedMarket?.code === m.code;
                      const isRec = livePrediction.recommendedMarket.code === m.code;
                      return (
                        <button
                          key={m.code}
                          type="button"
                          className={`fai-market-card ${isSelected ? "active" : ""}`}
                          onClick={() => setSelectedMarketCode(m.code)}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 10,
                              color: isRec ? "#00e676" : "#7882ab",
                              textTransform: "uppercase",
                              marginBottom: 4,
                            }}
                          >
                            <span>{m.group}</span>
                            {isRec && <span>★ Choix sûr IA</span>}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                            {m.label}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                            }}
                          >
                            <span style={{ color: "#00e5ff", fontWeight: 800 }}>{m.pct}%</span>
                            <span style={{ color: "#9aa3c7" }}>~{m.marketOdd.toFixed(2)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 22,
                    padding: 18,
                    borderRadius: 14,
                    background: "linear-gradient(135deg, rgba(8,10,28,0.95), rgba(18,16,46,0.92))",
                    border: "1px solid rgba(124, 77, 255, 0.35)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: showAnalysis ? 10 : 0,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#00e5ff", letterSpacing: 1 }}>
                      🧠 SYNTHÈSE TACTIQUE &amp; MATHÉMATIQUE IA
                    </span>
                    <button
                      type="button"
                      className="fai-btn-ghost"
                      onClick={() => setShowAnalysis((v) => !v)}
                    >
                      {showAnalysis ? "Réduire" : "Afficher l'analyse"}
                    </button>
                  </div>
                  {showAnalysis && (
                    <div
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.65,
                        color: "#dce1ff",
                        whiteSpace: "pre-line",
                      }}
                    >
                      {expertNarrative}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="fai-btn-primary"
                    style={{ flex: "2 1 260px" }}
                    onClick={handleAddToCouponAndHistory}
                  >
                    🎰 Ajouter au Coupon ({currentPickedMarket?.label} •{" "}
                    {currentPickedMarket?.pct}%)
                  </button>
                  <button
                    type="button"
                    className="fai-btn-secondary"
                    style={{ flex: "1 1 190px" }}
                    onClick={handleSaveHistoryOnly}
                  >
                    📥 Enregistrer dans l&apos;Historique
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================
            ONGLET COMPARATEUR FACE-À-FACE (RADAR + MONTE-CARLO)
           ====================================================== */}
        {tab === "h2h" && (
          <HeadToHeadTab
            modelState={modelState}
            defaultHome={activeMatch.home}
            defaultAway={activeMatch.away}
            defaultLeague={activeMatch.league}
            onSendToPredict={(h, a, lg) => {
              setForm({ home: h, away: a, league: lg });
              setActiveMatch({ home: h, away: a, league: lg });
              setTab("predict");
            }}
          />
        )}

        {/* ======================================================
            ONGLET ANALYSE VIDÉO IA (VISION CANVAS + PRESSING)
           ====================================================== */}
        {tab === "video" && (
          <VideoAnalysisTab
            activeHome={activeMatch.home}
            activeAway={activeMatch.away}
            videoInsight={videoInsight}
            onVideoInsightReady={(res) => {
              setVideoInsight(res);
              triggerToast(`🎥 Vidéo analysée — Pressing ${res.pressingScore}/100 !`);
            }}
            onClearVideoInsight={() => {
              setVideoInsight(null);
              triggerToast("Modificateur vidéo désactivé.");
            }}
            onApplyAndGoPredict={() => {
              triggerToast("⚡ Modificateurs xG Vidéo injectés dans la prédiction !");
              setTab("predict");
            }}
          />
        )}

        {/* ======================================================
            ONGLET FANTASY FOOTBALL IA (11 TYPE & CAPITAINE ×2)
           ====================================================== */}
        {tab === "fantasy" && (
          <FantasyTab modelState={modelState} liveMatches={enrichedLiveFeed.matches} />
        )}

        {/* ======================================================
            ONGLET PONT IA TEMPS RÉEL CLOÉ <-> FOOTBALL AI
           ====================================================== */}
        {tab === "cloe" && (
          <CloeBridgeTab
            predictions={predictions}
            optaOverrides={optaOverrides}
            evolvedHyper={evolvedHyper}
            learnedExternalIds={learnedExternalIds}
            liveFixturesSnapshot={{
              yesterday: [],
              today: enrichedLiveFeed.matches || [],
              tomorrow: [],
            }}
            showToast={triggerToast}
          />
        )}

        {/* ======================================================
            ONGLET MOTEUR LIVE IN-PLAY MINUTE PAR MINUTE
           ====================================================== */}
        {tab === "inplay" && (
          <InPlayTab
            defaultHome={activeMatch.home}
            defaultAway={activeMatch.away}
            defaultLeague={activeMatch.league}
            modelState={modelState}
            liveMatches={enrichedLiveFeed.matches}
            onAddLivePickToCoupon={(item) => {
              setCoupon((prev) => [
                ...prev,
                { ...item, id: Date.now() + Math.floor(Math.random() * 1000) },
              ]);
              triggerToast(`🎰 Sélection Live ajoutée au Coupon !`);
            }}
          />
        )}

        {/* ======================================================
            ONGLET COUPON COMBINÉ INTELLIGENT + 3 TICKETS AUTO + BANKROLL
           ====================================================== */}
        {tab === "coupon" && (
          <div>
            <BankrollAndTicketsPanel
              liveMatches={enrichedLiveFeed.matches}
              modelState={modelState}
              coupon={coupon}
              stake={stake}
              currency={currency}
              couponSummary={couponSummary}
              onLoadGeneratedTicket={(items, suggestedStake, badge) => {
                setCoupon(items);
                setStake(suggestedStake);
                triggerToast(`${badge} chargé avec mise optimale !`);
              }}
              onApplyRecommendedStake={(amt) => {
                setStake(amt);
                triggerToast(`🛡️ Mise optimale Kelly appliquée !`);
              }}
              showToast={triggerToast}
            />
            {coupon.length === 0 ? (
              <div className="fai-panel" style={{ textAlign: "center", padding: "48px 24px" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎰</div>
                <h3 style={{ fontSize: 18, marginBottom: 8 }}>Votre Coupon Combiné est vide</h3>
                <p style={{ fontSize: 13, color: "#8e98c2", maxWidth: 460, margin: "0 auto 20px" }}>
                  Sélectionnez directement les meilleures opportunités dans{" "}
                  <strong>Matchs du Jour</strong> ou analysez un duel sur mesure dans{" "}
                  <strong>Prédire</strong>.
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="fai-btn-secondary"
                    onClick={() => setTab("live")}
                  >
                    📅 Voir les Matchs du Jour
                  </button>
                  <button
                    type="button"
                    className="fai-btn-ghost"
                    onClick={() => setTab("predict")}
                  >
                    🎯 Analyser un match manuel
                  </button>
                </div>
              </div>
            ) : (
              <div className="fai-grid-2">
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <span className="fai-section-title" style={{ marginBottom: 0 }}>
                      📋 Sélections du Ticket ({coupon.length})
                    </span>
                    <button
                      type="button"
                      className="fai-btn-ghost"
                      onClick={() => setCoupon([])}
                    >
                      🧹 Vider le coupon
                    </button>
                  </div>

                  {coupon.map((item) => {
                    const won = checkPickResult(item);
                    const isWeakest =
                      coupon.length > 1 && couponSummary?.weakestLeg?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        className="fai-panel"
                        style={{
                          padding: 16,
                          marginBottom: 12,
                          borderColor:
                            won === true
                              ? "#00e676"
                              : won === false
                                ? "#ff3d5a"
                                : isWeakest
                                  ? "rgba(255, 145, 0, 0.55)"
                                  : "var(--border-muted)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 10,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 11, color: "#7f89b2" }}>
                              {LEAGUES[item.league]?.name} • {item.date}
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
                              {item.home} vs {item.away}
                            </div>
                            <div
                              style={{
                                marginTop: 6,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "4px 10px",
                                borderRadius: 8,
                                background: "rgba(0, 229, 255, 0.1)",
                                color: "#00e5ff",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              <span>🎯 {item.selectedMarket?.label}</span>
                              <span>({item.selectedMarket?.pct}%)</span>
                            </div>
                            {isWeakest && (
                              <div style={{ fontSize: 11, color: "#ff9100", marginTop: 6 }}>
                                ⚠️ Maillon le plus risqué du combiné
                              </div>
                            )}
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <label
                              style={{
                                display: "block",
                                fontSize: 10,
                                color: "#7f89b2",
                                marginBottom: 4,
                              }}
                            >
                              COTE BOOKMAKER
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="1.01"
                              className="fai-input"
                              style={{
                                width: 84,
                                padding: "6px 8px",
                                textAlign: "center",
                                fontFamily: "var(--font-mono)",
                              }}
                              value={
                                item.selectedMarket?.rawOddInput ??
                                item.selectedMarket?.bookOdd ??
                                1.5
                              }
                              onChange={(e) => handleUpdateCouponOdd(item.id, e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setCoupon((prev) => prev.filter((c) => c.id !== item.id))
                              }
                              style={{
                                display: "block",
                                marginLeft: "auto",
                                marginTop: 8,
                                background: "transparent",
                                border: "none",
                                color: "#7f89b2",
                                fontSize: 11,
                                cursor: "pointer",
                              }}
                            >
                              ✕ Retirer
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {couponSummary && (
                  <div className="fai-panel" style={{ alignSelf: "start" }}>
                    <div className="fai-section-title">
                      <span>💰 Simulateur Bankroll &amp; Gains</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {["FCFA", "€"].map((cur) => (
                          <button
                            key={cur}
                            type="button"
                            className="fai-btn-ghost"
                            style={{
                              padding: "3px 8px",
                              fontSize: 11,
                              borderColor: currency === cur ? "#00e5ff" : undefined,
                              color: currency === cur ? "#00e5ff" : undefined,
                            }}
                            onClick={() => {
                              setCurrency(cur);
                              setStake(cur === "FCFA" ? 2000 : 10);
                            }}
                          >
                            {cur}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="fai-label">Mise engagée ({currency})</label>
                    <input
                      type="number"
                      min="1"
                      className="fai-input"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 16 }}
                      value={stake}
                      onChange={(e) => setStake(Math.max(0, Number(e.target.value) || 0))}
                    />

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {(currency === "FCFA" ? [1000, 2000, 5000, 10000] : [5, 10, 25, 50]).map(
                        (preset) => (
                          <button
                            key={preset}
                            type="button"
                            className="fai-quick-chip"
                            onClick={() => setStake(preset)}
                          >
                            {preset.toLocaleString("fr-FR")} {currency}
                          </button>
                        )
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: 18,
                        padding: 16,
                        borderRadius: 12,
                        background: "#080a1a",
                        border: "1px solid var(--border-muted)",
                      }}
                    >
                      {[
                        ["Cote Totale Combinée", couponSummary.combinedBookOdd.toFixed(2), "#fff"],
                        [
                          "Probabilité Réelle IA",
                          `${couponSummary.combinedProbPct}%`,
                          couponSummary.riskColor,
                        ],
                        [
                          "Juste Cote Mathématique",
                          couponSummary.fairCombinedOdd.toFixed(2),
                          "#9aa3c7",
                        ],
                        [
                          "Espérance Mathématique (EV)",
                          `${couponSummary.evPct >= 0 ? "+" : ""}${couponSummary.evPct}%`,
                          couponSummary.evPct >= 0 ? "#00e676" : "#ff9100",
                        ],
                      ].map(([k, v, col]) => (
                        <div
                          key={k}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "7px 0",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            fontSize: 13,
                          }}
                        >
                          <span style={{ color: "#9aa3c7" }}>{k}</span>
                          <strong style={{ fontFamily: "var(--font-mono)", color: col }}>
                            {v}
                          </strong>
                        </div>
                      ))}

                      <div
                        style={{
                          marginTop: 14,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700 }}>GAIN POTENTIEL</span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 22,
                            fontWeight: 900,
                            color: "#00e676",
                          }}
                        >
                          {formatMoney(couponSummary.potentialPayout, currency)}
                        </span>
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          fontSize: 11,
                          color: "#7f89b2",
                          marginTop: 3,
                        }}
                      >
                        Bénéfice net : +{formatMoney(couponSummary.netProfit, currency)}
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        borderRadius: 10,
                        background: `${couponSummary.riskColor}14`,
                        border: `1px solid ${couponSummary.riskColor}55`,
                        fontSize: 12,
                      }}
                    >
                      <strong style={{ color: couponSummary.riskColor }}>
                        Profil de risque : {couponSummary.riskLabel}
                      </strong>
                    </div>

                    <button
                      type="button"
                      className="fai-btn-primary"
                      style={{ marginTop: 14 }}
                      onClick={handleShareCoupon}
                    >
                      📤 Partager / Copier le Coupon (WhatsApp • Telegram)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ======================================================
            ONGLET HISTORIQUE & VALIDATION
           ====================================================== */}
        {tab === "history" && (
          <div>
            <div className="fai-panel" style={{ padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    ["all", `Tous (${predictions.length})`],
                    [
                      "pending",
                      `⏳ À valider (${predictions.filter((p) => !isValidated(p)).length})`,
                    ],
                    ["correct", `✓ IA Correcte (${modelState.metrics.correct})`],
                    ["wrong", `✗ Erreurs Apprises (${modelState.errorJournal.length})`],
                  ].map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      className={`fai-league-pill ${historyFilter === id ? "selected" : ""}`}
                      onClick={() => setHistoryFilter(id)}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="fai-btn-secondary"
                    onClick={() => ingestFinishedMatches(false)}
                  >
                    🔄 Auto-Valider Résultats Officiels
                  </button>
                  <input
                    className="fai-input"
                    style={{ maxWidth: 210, padding: "8px 12px", fontSize: 12 }}
                    placeholder="🔍 Filtrer par club..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="fai-panel" style={{ textAlign: "center", padding: "44px 20px" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
                <p style={{ color: "#9aa3c7", fontSize: 14, marginBottom: 16 }}>
                  Aucune prédiction dans cette vue. Lancez l&apos;auto-apprentissage des résultats
                  réels ou le jeu de calibration !
                </p>
                <button
                  type="button"
                  className="fai-btn-secondary"
                  onClick={handleRunCalibration}
                >
                  ⚡ Charger &amp; Calibrer sur 24 matchs réels
                </button>
              </div>
            ) : (
              filteredHistory.map((pred) => (
                <PredictionCard
                  key={pred.id}
                  pred={pred}
                  onValidate={handleValidateMatch}
                  onDelete={handleDeleteMatch}
                />
              ))
            )}
          </div>
        )}

        {/* ======================================================
            ONGLET MÉMOIRE PROFONDE, DIAGNOSTIC ERREURS & AUTO-IA
           ====================================================== */}
        {tab === "stats" && (
          <div>
            {/* Bannière Centre Neuronal d'Auto-Amélioration Continue */}
            <div
              className="fai-panel"
              style={{
                borderColor: "rgba(0, 229, 255, 0.45)",
                background:
                  "linear-gradient(135deg, rgba(10,16,44,0.96), rgba(20,16,54,0.94))",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div className="fai-section-title" style={{ marginBottom: 4 }}>
                    <span>🧬 Centre Neuronal d&apos;Auto-Amélioration Continue — Génération #{genNumber}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: "#cbd2f5", maxWidth: 600 }}>
                    À chaque match réel terminé ou validé, l&apos;IA autopsie ses erreurs (piège à
                    domicile, match nul tactique, exploit d&apos;outsider), corrige ses coefficients
                    spécifiques par club et recalibre ses hyperparamètres sur plusieurs époques.
                  </p>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="fai-btn-primary"
                    style={{ width: "auto" }}
                    onClick={handleManualSelfEvolution}
                  >
                    ⚡ Optimiser l&apos;IA Maintenant (Multi-Époques)
                  </button>
                  <button
                    type="button"
                    className="fai-btn-secondary"
                    onClick={() => ingestFinishedMatches(false)}
                  >
                    📡 Apprendre des Vrais Matchs Terminés
                  </button>
                </div>
              </div>
            </div>

            {/* 4 KPIs Scientifiques */}
            <div className="fai-stats-grid">
              <div className="fai-stat-card">
                <div className="fai-kpi-lbl">Précision 1X2 Sec</div>
                <div
                  className="fai-kpi-val"
                  style={{ fontSize: 28, marginTop: 6, color: "#00e676" }}
                >
                  {acc !== null ? `${acc}%` : "—"}
                </div>
                <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 4 }}>
                  {modelState.metrics.correct} / {modelState.metrics.total} issues exactes
                </div>
              </div>

              <div className="fai-stat-card">
                <div className="fai-kpi-lbl">Précision Marchés Coupon</div>
                <div
                  className="fai-kpi-val"
                  style={{ fontSize: 28, marginTop: 6, color: "#00e5ff" }}
                >
                  {modelState.metrics.marketAccuracyPct !== null
                    ? `${modelState.metrics.marketAccuracyPct}%`
                    : "—"}
                </div>
                <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 4 }}>
                  Couverture sécurisée IA
                </div>
              </div>

              <div className="fai-stat-card">
                <div className="fai-kpi-lbl">Brier Score (Calibration)</div>
                <div
                  className="fai-kpi-val"
                  style={{ fontSize: 28, marginTop: 6, color: "#9d7bff" }}
                >
                  {modelState.metrics.brierScore !== null
                    ? modelState.metrics.brierScore.toFixed(3)
                    : "—"}
                </div>
                <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 4 }}>
                  Plus proche de 0 = mieux calibré
                </div>
              </div>

              <div className="fai-stat-card">
                <div className="fai-kpi-lbl">Erreurs Autopsiées</div>
                <div
                  className="fai-kpi-val"
                  style={{ fontSize: 28, marginTop: 6, color: "#ffea00" }}
                >
                  {modelState.errorJournal.length}
                </div>
                <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 4 }}>
                  Converties en correctifs actifs
                </div>
              </div>
            </div>

            {/* Poids Appris + Courbe d'Évolution de la Précision */}
            <div className="fai-grid-2">
              <div className="fai-panel">
                <div className="fai-section-title">
                  <span>⚙️ Hyperparamètres Auto-Calibrés (Génération #{genNumber})</span>
                </div>
                {[
                  [
                    "Poids Modèle Poisson Dixon-Coles",
                    `${Math.round(modelState.hyper.dcWeight * 100)}%`,
                    modelState.hyper.dcWeight * 100,
                    "#00e5ff",
                  ],
                  [
                    "Sensibilité Match Nul (Draw Scale)",
                    `×${modelState.hyper.drawScale.toFixed(3)}`,
                    (modelState.hyper.drawScale / 1.4) * 100,
                    "#9d7bff",
                  ],
                  [
                    "Coefficient Avantage Domicile",
                    `×${modelState.hyper.homeAdvScale.toFixed(3)}`,
                    (modelState.hyper.homeAdvScale / 1.35) * 100,
                    "#00e676",
                  ],
                  [
                    "Température Échelle Elo",
                    `×${(modelState.hyper.eloTemperature || 1).toFixed(3)}`,
                    ((modelState.hyper.eloTemperature || 1) / 1.2) * 100,
                    "#ffea00",
                  ],
                ].map(([label, textVal, barPct, color]) => (
                  <div key={label} style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ color: "#cbd2f5" }}>{label}</span>
                      <strong style={{ fontFamily: "var(--font-mono)", color }}>{textVal}</strong>
                    </div>
                    <div style={{ height: 7, background: "#141836", borderRadius: 4 }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, barPct)}%`,
                          background: color,
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="fai-panel">
                <div className="fai-section-title">
                  <span>📈 Courbe de Progression &amp; Précision par Confiance</span>
                </div>
                <LearningCurveChart curve={modelState.learningCurve} />
                {Object.values(modelState.metrics.buckets).map((b) => {
                  const pct = b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0;
                  return (
                    <div key={b.label} style={{ marginBottom: 10 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12,
                          marginBottom: 4,
                        }}
                      >
                        <span>{b.label}</span>
                        <strong style={{ fontFamily: "var(--font-mono)" }}>
                          {b.total > 0 ? `${pct}% (${b.correct}/${b.total})` : "0 match"}
                        </strong>
                      </div>
                      <div style={{ height: 6, background: "#141836", borderRadius: 4 }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "linear-gradient(90deg, #00e5ff, #00e676)",
                            borderRadius: 4,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Journal Post-Mortem des Erreurs & Leçons Retenues par l'IA */}
            <div className="fai-panel">
              <div className="fai-section-title">
                <span>🔬 Journal d&apos;Autopsie des Erreurs &amp; Correctifs Appris par l&apos;IA</span>
                <span style={{ color: "#ffea00" }}>
                  {modelState.errorJournal.length} leçon(s) active(s)
                </span>
              </div>

              {modelState.errorJournal.length === 0 ? (
                <p style={{ fontSize: 13, color: "#8e98c2" }}>
                  Aucune erreur enregistrée pour le moment. Cliquez sur « Calibrer sur 24 matchs »
                  ou validez des matchs pour observer comment l&apos;IA diagnostique ses erreurs et
                  corrige ses coefficients d&apos;équipe !
                </p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {modelState.errorJournal.slice(0, 8).map((errItem) => (
                    <div
                      key={errItem.id}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        background: "#080a1c",
                        borderLeft: `4px solid ${errItem.diagnosis.color}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          fontSize: 12.5,
                          marginBottom: 4,
                        }}
                      >
                        <strong>
                          {errItem.matchTitle} ({errItem.scoreText}) —{" "}
                          <span style={{ color: errItem.diagnosis.color }}>
                            {errItem.diagnosis.title}
                          </span>
                        </strong>
                        <span style={{ color: "#8e98c2", fontSize: 11 }}>
                          Prédit : {errItem.predictedOutcome} ({errItem.predictedPct}%) → Réel :{" "}
                          {errItem.actualOutcome}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "#9aa3c7" }}>
                        🧠 <strong>Correctif mémorisé :</strong> {errItem.diagnosis.lesson}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Classement dynamique des équipes apprises */}
            <div className="fai-panel">
              <div className="fai-section-title">
                <span>🏆 Classement Elo Dynamique &amp; Biais Spécifiques Appris par Club</span>
                <span style={{ color: "#7f89b2" }}>{learnedTeamsList.length} clubs actifs</span>
              </div>

              {learnedTeamsList.length === 0 ? (
                <p style={{ fontSize: 13, color: "#8e98c2" }}>
                  Chargez les 24 matchs de calibration ou auto-apprenez les résultats réels du jour
                  pour peupler le classement dynamique.
                </p>
              ) : (
                <div className="fai-table-wrap">
                  <table className="fai-table">
                    <thead>
                      <tr>
                        <th>Équipe</th>
                        <th>MJ</th>
                        <th>Bilan</th>
                        <th>Buts</th>
                        <th>Forme</th>
                        <th>Affinité Nul</th>
                        <th>Elo Actuel (Δ)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {learnedTeamsList.slice(0, 20).map((t) => (
                        <tr key={t.key}>
                          <td style={{ fontWeight: 700 }}>{t.name}</td>
                          <td style={{ fontFamily: "var(--font-mono)" }}>{t.games}</td>
                          <td style={{ fontFamily: "var(--font-mono)" }}>
                            {t.wins}V-{t.draws}N-{t.losses}D
                          </td>
                          <td style={{ fontFamily: "var(--font-mono)" }}>
                            {t.goalsFor}:{t.goalsAgainst}
                          </td>
                          <td>
                            <FormBadges form={t.form} />
                          </td>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                            ×{t.drawAffinity.toFixed(2)}
                          </td>
                          <td style={{ fontFamily: "var(--font-mono)", fontWeight: 800 }}>
                            {Math.round(t.elo)}{" "}
                            <span
                              style={{
                                fontSize: 11,
                                color: t.eloDelta >= 0 ? "#00e676" : "#ff3d5a",
                              }}
                            >
                              ({t.eloDelta >= 0 ? "+" : ""}
                              {t.eloDelta})
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Synchronisation Cloud Firebase */}
            <div className="fai-panel">
              <div className="fai-section-title">
                <span>☁️ Synchronisation Cloud Firebase (Multi-Appareils)</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <input
                  className="fai-input"
                  placeholder="https://votre-projet-default-rtdb.firebaseio.com"
                  value={cloudCfg.databaseUrl}
                  onChange={(e) =>
                    setCloudCfg((prev) => ({ ...prev, databaseUrl: e.target.value }))
                  }
                />
                <input
                  className="fai-input"
                  placeholder="Code profil (ex: pro-2026)"
                  value={cloudCfg.syncRoom}
                  onChange={(e) =>
                    setCloudCfg((prev) => ({ ...prev, syncRoom: e.target.value }))
                  }
                />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="fai-btn-secondary"
                  disabled={cloudBusy || !cloudCfg.databaseUrl.trim()}
                  onClick={handlePushCloud}
                >
                  ☁️ Envoyer vers Firebase Cloud
                </button>
                <button
                  type="button"
                  className="fai-btn-ghost"
                  disabled={cloudBusy || !cloudCfg.databaseUrl.trim()}
                  onClick={handlePullCloud}
                >
                  🔄 Récupérer depuis Firebase Cloud
                </button>
              </div>
            </div>

            {/* Administration Mémoire */}
            <div className="fai-panel">
              <div className="fai-section-title">
                <span>🛠️ Gestion &amp; Sauvegarde de la Mémoire IA</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="fai-btn-secondary"
                  onClick={handleRunCalibration}
                >
                  ⚡ Pré-entraîner sur 24 matchs réels
                </button>
                <button type="button" className="fai-btn-ghost" onClick={handleExportJSON}>
                  📤 Exporter Mémoire (.json)
                </button>
                <button
                  type="button"
                  className="fai-btn-ghost"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📥 Importer Mémoire (.json)
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  style={{ display: "none" }}
                  onChange={handleImportJSON}
                />

                {!confirmReset ? (
                  <button
                    type="button"
                    className="fai-btn-ghost"
                    style={{
                      color: "#ff3d5a",
                      borderColor: "rgba(255,61,90,0.4)",
                      marginLeft: "auto",
                    }}
                    onClick={() => setConfirmReset(true)}
                  >
                    🗑️ Réinitialiser la mémoire
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
                    <span style={{ fontSize: 12, color: "#ff3d5a", fontWeight: 700 }}>
                      Confirmer l&apos;effacement ?
                    </span>
                    <button
                      type="button"
                      className="fai-btn-ghost"
                      style={{ background: "#ff3d5a", color: "#fff", borderColor: "#ff3d5a" }}
                      onClick={handleConfirmedReset}
                    >
                      Oui, tout effacer
                    </button>
                    <button
                      type="button"
                      className="fai-btn-ghost"
                      onClick={() => setConfirmReset(false)}
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {toast && <div className="fai-toast">{toast}</div>}
    </div>
  );
}
