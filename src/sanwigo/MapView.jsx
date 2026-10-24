import React, { useEffect, useState } from "react";
import { POIS } from "./data.js";

// Carte stylisée HORS-LIGNE d'Aboisso (SVG vectoriel, aucun appel externe).
// AMELIORATION : fonctionne sans clé Google Maps et avec un réseau faible,
// cas fréquent hors d'Abidjan. En production : brancher tuiles OSM/Leaflet
// en conservant ce mode dégradé comme secours.
export default function MapView({ fromId, toId, stopId, drivers = [], ridePhase = "idle", rideProgress = 0, matchedDriverId = null, onPickPoi }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1400);
    return () => clearInterval(t);
  }, []);

  const byId = Object.fromEntries(POIS.map((p) => [p.id, p]));
  const from = byId[fromId];
  const to = byId[toId];
  const stop = stopId ? byId[stopId] : null;

  // Position animée du chauffeur affecté pendant le suivi.
  const matched = drivers.find((d) => d.id === matchedDriverId);
  let carPos = null;
  if (matched && from) {
    const start = byId[matched.poiId] || from;
    if (ridePhase === "to_pickup") {
      carPos = lerp(start, from, rideProgress);
    } else if (ridePhase === "arrived") {
      carPos = { x: from.x, y: from.y };
    } else if (ridePhase === "in_progress" && to) {
      carPos = stop && rideProgress < 0.5 ? lerp(from, stop, rideProgress * 2) : lerp(stop || from, to, stop ? (rideProgress - 0.5) * 2 : rideProgress);
    } else if (ridePhase === "completed" && to) {
      carPos = { x: to.x, y: to.y };
    }
  }

  const routePts = [from, stop, to].filter(Boolean);

  return (
    <div className="sg-mapbox">
      <svg viewBox="0 0 100 100" className="sg-map" role="img" aria-label="Carte stylisée d'Aboisso">
        {/* fond quartiers */}
        <rect x="0" y="0" width="100" height="100" fill="#eaf3e4" />
        <ellipse cx="30" cy="38" rx="26" ry="20" fill="#fdf3d8" opacity="0.8" />
        <ellipse cx="62" cy="55" rx="30" ry="24" fill="#e2efdb" opacity="0.8" />
        {/* Soumié River */}
        <path d="M-2 70 C 20 62, 38 78, 55 64 S 88 58, 102 66" fill="none" stroke="#7ec3e8" strokeWidth="3.2" opacity="0.9" />
        <text x="12" y="76" className="sg-map-label sg-river">Soumié River</text>
        {/* Routes principales */}
        <path d="M-2 50 L38 48 L54 49 L102 44" fill="none" stroke="#ffffff" strokeWidth="2.6" />
        <path d="M-2 50 L38 48 L54 49 L102 44" fill="none" stroke="#c9ced6" strokeWidth="0.5" strokeDasharray="2 1.6" />
        <text x="80" y="41" className="sg-map-label">A100 → Noé / Ghana</text>
        <text x="1" y="46" className="sg-map-label">← Bonoua · Abidjan</text>
        <path d="M50 49 C 56 36, 66 24, 79 12" fill="none" stroke="#ffffff" strokeWidth="2.2" />
        <text x="66" y="18" className="sg-map-label">Route d'Ayamé ↑</text>
        <path d="M50 49 C 50 66, 46 80, 41 93" fill="none" stroke="#fff7e0" strokeWidth="1.8" />
        <text x="30" y="88" className="sg-map-label">↓ Krinjabo</text>
        <path d="M38 48 L32 34 M54 49 L66 27 M46 49 L48 31" fill="none" stroke="#ffffff" strokeWidth="1.4" opacity="0.9" />

        {/* trajet sélectionné */}
        {routePts.length > 1 && (
          <polyline points={routePts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#067a46" strokeWidth="1.5" strokeDasharray="2.4 1.2" className="sg-route" />
        )}

        {/* chauffeurs disponibles (léger mouvement vivant) */}
        {drivers.filter((d) => d.enLigne && d.id !== matchedDriverId).map((d, i) => {
          const p = byId[d.poiId];
          if (!p) return null;
          const dx = Math.sin(tick / 2 + i * 1.7) * 1.2;
          const dy = Math.cos(tick / 2.4 + i * 2.1) * 1.0;
          return (
            <g key={d.id} transform={`translate(${p.x + dx},${p.y + dy})`} className="sg-car-idle">
              <circle r="2.1" fill="#111" opacity="0.9" />
              <text y="1.2" textAnchor="middle" className="sg-car-emoji">🚗</text>
            </g>
          );
        })}

        {/* POI cliquables */}
        {POIS.map((p) => {
          const isFrom = p.id === fromId;
          const isTo = p.id === toId;
          const isStop = p.id === stopId;
          return (
            <g key={p.id} transform={`translate(${p.x},${p.y})`} onClick={() => onPickPoi && onPickPoi(p.id)} className="sg-poi">
              <circle r={isFrom || isTo ? 3 : 2.4} fill={isFrom ? "#067a46" : isTo ? "#d92323" : isStop ? "#f2a900" : "#ffffff"} stroke="#334" strokeWidth="0.35" />
              <text y="1.4" textAnchor="middle" className="sg-poi-emoji">{p.icon}</text>
              {(isFrom || isTo || isStop || p.populaire) && (
                <text y="-3.6" textAnchor="middle" className="sg-poi-name">{shortName(p.nom)}</text>
              )}
            </g>
          );
        })}

        {/* voiture affectée animée */}
        {carPos && (
          <g transform={`translate(${carPos.x},${carPos.y})`} className="sg-car-live">
            <circle r="4.6" fill="#f2a900" opacity="0.35" className="sg-pulse" />
            <circle r="2.8" fill="#f2a900" stroke="#111" strokeWidth="0.4" />
            <text y="1.5" textAnchor="middle" className="sg-car-emoji">🚖</text>
          </g>
        )}
      </svg>
      <div className="sg-map-hint">🗺️ Carte d'Aboisso (mode hors-ligne) — touchez un lieu pour le choisir comme destination</div>
    </div>
  );
}

function lerp(a, b, t) {
  const c = Math.min(1, Math.max(0, t));
  return { x: a.x + (b.x - a.x) * c, y: a.y + (b.y - a.y) * c };
}
function shortName(n) {
  return n.replace(" d'Aboisso", "").replace(" (Hôpital régional)", "").replace(" (centre-ville)", "").replace(" (capitale du royaume Sanwi)", "");
}
