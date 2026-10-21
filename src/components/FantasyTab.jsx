import { useState, useMemo, useEffect } from "react";
import { scoreFantasyPlayers, optimizeFantasySquad } from "../data/players.js";

const FORMATIONS = ["1-4-3-3", "1-3-4-3", "1-4-4-2", "1-3-5-2"];

export default function FantasyTab({ modelState, liveMatches }) {
  const [formation, setFormation] = useState("1-4-3-3");
  const [budget, setBudget] = useState(100.0);
  const [posFilter, setPosFilter] = useState("ALL");

  const scoredPlayers = useMemo(
    () => scoreFantasyPlayers(modelState, liveMatches),
    [modelState, liveMatches]
  );

  const autoSquad = useMemo(
    () => optimizeFantasySquad(scoredPlayers, budget, formation),
    [scoredPlayers, budget, formation]
  );

  const [customLineup, setCustomLineup] = useState(autoSquad.lineup);
  const [captainId, setCaptainId] = useState(autoSquad.captainId);

  useEffect(() => {
    setCustomLineup(autoSquad.lineup);
    setCaptainId(autoSquad.captainId);
  }, [autoSquad]);

  const totalSpent = useMemo(
    () => Math.round(customLineup.reduce((s, p) => s + p.price, 0) * 10) / 10,
    [customLineup]
  );

  const totalProjected = useMemo(() => {
    const base = customLineup.reduce((s, p) => s + p.expectedPoints, 0);
    const capBonus = customLineup.find((p) => p.id === captainId)?.expectedPoints || 0;
    return Math.round((base + capBonus) * 10) / 10;
  }, [customLineup, captainId]);

  const rowsByPos = useMemo(
    () => [
      customLineup.filter((p) => p.pos === "FWD"),
      customLineup.filter((p) => p.pos === "MID"),
      customLineup.filter((p) => p.pos === "DEF"),
      customLineup.filter((p) => p.pos === "GKP"),
    ],
    [customLineup]
  );

  const handleSwapInPlayer = (candidate) => {
    if (customLineup.some((p) => p.id === candidate.id)) return;
    const samePos = customLineup.filter((p) => p.pos === candidate.pos);
    if (samePos.length === 0) return;
    // Remplacer le joueur de même poste ayant le moins de points attendus si le budget le permet
    const sorted = [...samePos].sort((a, b) => a.expectedPoints - b.expectedPoints);
    for (const target of sorted) {
      const nextCost = totalSpent - target.price + candidate.price;
      if (nextCost <= budget + 0.01) {
        setCustomLineup((prev) => prev.map((x) => (x.id === target.id ? candidate : x)));
        return;
      }
    }
  };

  return (
    <div>
      {/* Barre de configuration & KPIs Fantasy */}
      <div className="fai-panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="fai-section-title" style={{ marginBottom: 4 }}>
              <span>🏆 Optimiseur Fantasy IA (11 Titulaire &amp; Capitaine ×2)</span>
            </div>
            <p style={{ fontSize: 12, color: "#9aa3c7" }}>
              L&apos;algorithme sélectionne le meilleur 11 selon les <strong>xG / xA</strong>, la
              probabilité de <strong>Clean Sheet</strong> et les affiches réelles du jour.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {FORMATIONS.map((f) => (
              <button
                key={f}
                type="button"
                className={`fai-league-pill ${formation === f ? "selected" : ""}`}
                onClick={() => setFormation(f)}
              >
                {f}
              </button>
            ))}
            <select
              className="fai-input"
              style={{ width: 135, padding: "7px 10px", fontSize: 12 }}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            >
              <option value={85}>Budget 85 M€</option>
              <option value={95}>Budget 95 M€</option>
              <option value={100}>Budget 100 M€</option>
              <option value={110}>Budget 110 M€</option>
            </select>
          </div>
        </div>
      </div>

      <div className="fai-grid-2">
        {/* Terrain de Football Visuel */}
        <div className="fai-panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            <span>
              💰 Coût :{" "}
              <strong style={{ fontFamily: "var(--font-mono)", color: "#00e5ff" }}>
                {totalSpent.toFixed(1)} / {budget.toFixed(1)} M€
              </strong>
            </span>
            <span>
              ⚡ Projection IA :{" "}
              <strong style={{ fontFamily: "var(--font-mono)", color: "#00e676", fontSize: 16 }}>
                {totalProjected} pts
              </strong>
            </span>
          </div>

          {/* Pelouse tactique */}
          <div
            style={{
              borderRadius: 16,
              padding: "20px 10px",
              background:
                "repeating-linear-gradient(180deg, #0f5132 0px, #0f5132 42px, #13623d 42px, #13623d 84px)",
              border: "2px solid rgba(255,255,255,0.35)",
              boxShadow: "inset 0 0 40px rgba(0,0,0,0.45)",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            {rowsByPos.map((line, rIdx) => (
              <div
                key={rIdx}
                style={{
                  display: "flex",
                  justifyContent: "space-around",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {line.map((player) => {
                  const isCap = player.id === captainId;
                  return (
                    <div
                      key={player.id}
                      onClick={() => setCaptainId(player.id)}
                      title="Cliquez pour nommer Capitaine (Points ×2)"
                      style={{
                        width: 96,
                        padding: "7px 5px",
                        borderRadius: 10,
                        background: "rgba(7, 10, 26, 0.88)",
                        border: `1.5px solid ${isCap ? "#ffd700" : "#00e5ff"}`,
                        textAlign: "center",
                        cursor: "pointer",
                        position: "relative",
                      }}
                    >
                      {isCap && (
                        <span
                          style={{
                            position: "absolute",
                            top: -8,
                            right: -6,
                            background: "#ffd700",
                            color: "#000",
                            fontSize: 10,
                            fontWeight: 900,
                            padding: "1px 5px",
                            borderRadius: 999,
                          }}
                        >
                          👑 C ×2
                        </span>
                      )}
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#fff",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {player.name.split(" ").slice(-1)[0]}
                      </div>
                      <div style={{ fontSize: 9.5, color: "#9aa3c7" }}>{player.club}</div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          fontWeight: 800,
                          fontFamily: "var(--font-mono)",
                          color: "#00e676",
                        }}
                      >
                        {isCap
                          ? `${(player.expectedPoints * 2).toFixed(1)} pts`
                          : `${player.expectedPoints} pts`}
                      </div>
                      <div style={{ fontSize: 9.5, color: "#7f89b2" }}>{player.price} M€</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 8, textAlign: "center" }}>
            💡 Astuce : cliquez sur un joueur sur la pelouse pour lui donner le brassard de{" "}
            <strong>👑 Capitaine (Points ×2)</strong> !
          </div>
        </div>

        {/* Marché des Transferts & Pépites IA */}
        <div className="fai-panel">
          <div className="fai-section-title">
            <span>📋 Classement des Joueurs par Espérance de Points IA</span>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {["ALL", "FWD", "MID", "DEF", "GKP"].map((pos) => (
              <button
                key={pos}
                type="button"
                className={`fai-quick-chip ${posFilter === pos ? "active" : ""}`}
                style={{
                  borderColor: posFilter === pos ? "#00e5ff" : undefined,
                  color: posFilter === pos ? "#fff" : undefined,
                }}
                onClick={() => setPosFilter(pos)}
              >
                {pos === "ALL" ? "Tous les postes" : pos}
              </button>
            ))}
          </div>

          <div style={{ maxHeight: 430, overflowY: "auto" }}>
            <table className="fai-table">
              <thead>
                <tr>
                  <th>Joueur</th>
                  <th>Poste</th>
                  <th>Prix</th>
                  <th>Proj. IA</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {scoredPlayers
                  .filter((p) => posFilter === "ALL" || p.pos === posFilter)
                  .slice(0, 28)
                  .map((p) => {
                    const inTeam = customLineup.some((x) => x.id === p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{p.name}</div>
                          <div style={{ fontSize: 10.5, color: "#7f89b2" }}>
                            {p.club} • {p.fixtureLabel}
                          </div>
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{p.pos}</td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                          {p.price}M€
                        </td>
                        <td
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontWeight: 800,
                            color: "#00e676",
                          }}
                        >
                          {p.expectedPoints} pts
                        </td>
                        <td>
                          {inTeam ? (
                            <span style={{ fontSize: 11, color: "#00e5ff", fontWeight: 700 }}>
                              Titulaire
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="fai-quick-chip"
                              onClick={() => handleSwapInPlayer(p)}
                            >
                              + Intégrer
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
