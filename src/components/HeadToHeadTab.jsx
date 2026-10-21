import { useState, useMemo } from "react";
import { LEAGUES } from "../data/clubs.js";
import { computeHeadToHeadComparison } from "../engine/predictor.js";

function RadarChartSVG({ axes, nameA, nameB }) {
  const size = 270;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 92;

  const angleFor = (idx) => -Math.PI / 2 + (idx * 2 * Math.PI) / axes.length;

  const buildPolygon = (key) =>
    axes
      .map((ax, i) => {
        const r = (ax[key] / 100) * radius;
        const a = angleFor(i);
        return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
      })
      .join(" ");

  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", maxWidth: 290 }}>
        {/* Cercles de grille */}
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <circle
            key={scale}
            cx={cx}
            cy={cy}
            r={radius * scale}
            fill="none"
            stroke="rgba(124,77,255,0.22)"
            strokeWidth="1"
          />
        ))}
        {/* Rayons + étiquettes */}
        {axes.map((ax, i) => {
          const a = angleFor(i);
          const x2 = cx + radius * Math.cos(a);
          const y2 = cy + radius * Math.sin(a);
          const lx = cx + (radius + 24) * Math.cos(a);
          const ly = cy + (radius + 20) * Math.sin(a);
          return (
            <g key={ax.axis}>
              <line
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="1"
              />
              <text
                x={lx}
                y={ly}
                fill="#cbd2f5"
                fontSize="9.5"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {ax.axis}
              </text>
            </g>
          );
        })}

        {/* Polygone Équipe A (Cyan) */}
        <polygon
          points={buildPolygon("valA")}
          fill="rgba(0, 229, 255, 0.24)"
          stroke="#00e5ff"
          strokeWidth="2.2"
        />
        {/* Polygone Équipe B (Violet/Rose) */}
        <polygon
          points={buildPolygon("valB")}
          fill="rgba(255, 61, 154, 0.22)"
          stroke="#ff4d9a"
          strokeWidth="2.2"
        />
      </svg>

      <div style={{ display: "flex", justifyContent: "center", gap: 18, fontSize: 12 }}>
        <span style={{ color: "#00e5ff", fontWeight: 800 }}>● {nameA}</span>
        <span style={{ color: "#ff4d9a", fontWeight: 800 }}>● {nameB}</span>
      </div>
    </div>
  );
}

export default function HeadToHeadTab({ modelState, defaultHome, defaultAway, defaultLeague, onSendToPredict }) {
  const [teamA, setTeamA] = useState(defaultHome || "PSG");
  const [teamB, setTeamB] = useState(defaultAway || "Real Madrid");
  const [league, setLeague] = useState(defaultLeague || "ucl");

  const h2hData = useMemo(() => {
    if (!teamA.trim() || !teamB.trim()) return null;
    return computeHeadToHeadComparison(teamA, teamB, league, modelState);
  }, [teamA, teamB, league, modelState]);

  const classicRivalries = [
    ["Real Madrid", "FC Barcelone", "liga"],
    ["PSG", "Marseille", "ligue1"],
    ["Liverpool", "Manchester City", "premier"],
    ["Inter Milan", "AC Milan", "seriea"],
    ["Côte d'Ivoire", "Maroc", "international"],
  ];

  return (
    <div>
      <div className="fai-panel">
        <div className="fai-section-title">
          <span>⚔️ Comparateur Face-à-Face Tactique &amp; Simulation 10 000 Matchs</span>
        </div>

        <div className="fai-quick-matches">
          <span style={{ fontSize: 11, color: "#7882ab" }}>Duels de légende :</span>
          {classicRivalries.map(([a, b, lg]) => (
            <button
              key={`${a}-${b}`}
              type="button"
              className="fai-quick-chip"
              onClick={() => {
                setTeamA(a);
                setTeamB(b);
                setLeague(lg);
              }}
            >
              {a} vs {b}
            </button>
          ))}
        </div>

        <div className="fai-teams-row">
          <div>
            <label className="fai-label">🔵 Club / Sélection A</label>
            <input
              list="football-ai-clubs"
              className="fai-input"
              value={teamA}
              onChange={(e) => setTeamA(e.target.value)}
            />
          </div>
          <div style={{ paddingTop: 28, fontWeight: 900, color: "#00e5ff", textAlign: "center" }}>
            VS
          </div>
          <div>
            <label className="fai-label">🟣 Club / Sélection B</label>
            <input
              list="football-ai-clubs"
              className="fai-input"
              value={teamB}
              onChange={(e) => setTeamB(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <select
            className="fai-input"
            style={{ maxWidth: 260 }}
            value={league}
            onChange={(e) => setLeague(e.target.value)}
          >
            {Object.entries(LEAGUES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="fai-btn-secondary"
            onClick={() => onSendToPredict(teamA, teamB, league)}
          >
            🎯 Envoyer ce duel vers le Prédicteur Coupon
          </button>
        </div>
      </div>

      {h2hData && (
        <>
          <div className="fai-grid-2">
            {/* Radar SVG 6 axes */}
            <div className="fai-panel">
              <div className="fai-section-title">
                <span>🕸️ Radar Athlétique &amp; Tactique (0–100)</span>
              </div>
              <RadarChartSVG
                axes={h2hData.radarAxes}
                nameA={h2hData.teamA}
                nameB={h2hData.teamB}
              />
              <div style={{ marginTop: 12 }}>
                {h2hData.radarAxes.map((ax) => (
                  <div
                    key={ax.axis}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      padding: "4px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <strong style={{ color: "#00e5ff", fontFamily: "var(--font-mono)" }}>
                      {ax.valA}
                    </strong>
                    <span style={{ color: "#9aa3c7" }}>{ax.axis}</span>
                    <strong style={{ color: "#ff4d9a", fontFamily: "var(--font-mono)" }}>
                      {ax.valB}
                    </strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Simulation Monte-Carlo 10 000 matchs + 3 Scénarios Terrain */}
            <div className="fai-panel">
              <div className="fai-section-title">
                <span>🎲 Simulation Monte-Carlo (10 000 Matchs Complets)</span>
              </div>

              <div className="fai-stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                <div className="fai-stat-card" style={{ padding: 12, textAlign: "center" }}>
                  <div className="fai-kpi-lbl">{h2hData.teamA}</div>
                  <div className="fai-kpi-val" style={{ color: "#00e5ff", marginTop: 4 }}>
                    {h2hData.monteCarlo.winAPct}%
                  </div>
                </div>
                <div className="fai-stat-card" style={{ padding: 12, textAlign: "center" }}>
                  <div className="fai-kpi-lbl">Match Nul</div>
                  <div className="fai-kpi-val" style={{ color: "#ffea00", marginTop: 4 }}>
                    {h2hData.monteCarlo.drawPct}%
                  </div>
                </div>
                <div className="fai-stat-card" style={{ padding: 12, textAlign: "center" }}>
                  <div className="fai-kpi-lbl">{h2hData.teamB}</div>
                  <div className="fai-kpi-val" style={{ color: "#ff4d9a", marginTop: 4 }}>
                    {h2hData.monteCarlo.winBPct}%
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 12, color: "#cbd2f5", marginBottom: 16 }}>
                <div style={{ padding: "6px 0", display: "flex", justifyContent: "space-between" }}>
                  <span>Victoire large {h2hData.teamA} (écart ≥ 2 buts) :</span>
                  <strong style={{ fontFamily: "var(--font-mono)" }}>
                    {h2hData.monteCarlo.handicapA2PlusPct}%
                  </strong>
                </div>
                <div style={{ padding: "6px 0", display: "flex", justifyContent: "space-between" }}>
                  <span>Victoire large {h2hData.teamB} (écart ≥ 2 buts) :</span>
                  <strong style={{ fontFamily: "var(--font-mono)" }}>
                    {h2hData.monteCarlo.handicapB2PlusPct}%
                  </strong>
                </div>
                <div style={{ padding: "6px 0", display: "flex", justifyContent: "space-between" }}>
                  <span>Moyenne de buts simulés :</span>
                  <strong style={{ fontFamily: "var(--font-mono)", color: "#00e676" }}>
                    {h2hData.monteCarlo.avgGoals} buts / match
                  </strong>
                </div>
              </div>

              <div className="fai-section-title">
                <span>🏟️ Impact du Stade (3 Scénarios)</span>
              </div>
              {[
                [
                  `🏠 Chez ${h2hData.teamA}`,
                  `${h2hData.scenarios.homeA.probs[0]}% / ${h2hData.scenarios.homeA.probs[1]}% / ${h2hData.scenarios.homeA.probs[2]}%`,
                ],
                [
                  "⚖️ Finale Terrain Neutre",
                  `${h2hData.scenarios.neutral.probs[0]}% / ${h2hData.scenarios.neutral.probs[1]}% / ${h2hData.scenarios.neutral.probs[2]}%`,
                ],
                [
                  `✈️ Chez ${h2hData.teamB}`,
                  `${h2hData.scenarios.homeB.probs[2]}% / ${h2hData.scenarios.homeB.probs[1]}% / ${h2hData.scenarios.homeB.probs[0]}%`,
                ],
              ].map(([scLabel, probsText]) => (
                <div
                  key={scLabel}
                  style={{
                    padding: "9px 12px",
                    marginBottom: 8,
                    borderRadius: 9,
                    background: "#080a1a",
                    border: "1px solid var(--border-muted)",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12.5,
                  }}
                >
                  <span>{scLabel}</span>
                  <strong style={{ fontFamily: "var(--font-mono)", color: "#00e5ff" }}>
                    {probsText}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
