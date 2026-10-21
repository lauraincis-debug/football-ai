import { useMemo, useState } from "react";
import { generateThreeDailyTickets, exportCouponAsPngImage } from "../engine/ticketGenerator.js";

const BANKROLL_KEY = "football_ai_bankroll_v4";

function loadBankrollState(currency) {
  try {
    const raw = localStorage.getItem(BANKROLL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const startCap = currency === "EUR" ? 100 : 50000;
  return {
    initialCapital: startCap,
    currentCapital: startCap,
    ledger: [], // { id, date, label, stake, odd, status: 'won'|'lost', delta, balanceAfter }
  };
}

export default function BankrollAndTicketsPanel({
  liveMatches = [],
  modelState,
  coupon = [],
  stake,
  currency,
  couponSummary,
  onLoadGeneratedTicket,
  onApplyRecommendedStake,
  showToast,
}) {
  const [bankroll, setBankroll] = useState(() => loadBankrollState(currency));

  const saveBankroll = (next) => {
    setBankroll(next);
    try {
      localStorage.setItem(BANKROLL_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const fmtMoney = (val) =>
    currency === "EUR"
      ? `${Number(val).toFixed(2)} €`
      : `${Math.round(Number(val)).toLocaleString("fr-FR")} FCFA`;

  const autoTickets = useMemo(
    () => generateThreeDailyTickets(liveMatches, modelState),
    [liveMatches, modelState]
  );

  // Calculateur de mise optimale Kelly fractionnaire (1/4 Kelly plafonné à 5% pour zéro risque de ruine)
  const kellyStakeInfo = useMemo(() => {
    if (!couponSummary || coupon.length === 0) return null;
    const b = Math.max(0.05, couponSummary.combinedBookOdd - 1);
    const p = Math.min(0.95, Math.max(0.02, couponSummary.combinedProbPct / 100));
    const q = 1 - p;
    const rawKelly = (b * p - q) / b;
    const safePct =
      rawKelly > 0 ? Math.min(0.05, Math.max(0.01, rawKelly * 0.25)) : 0.015;
    const suggestedAmount =
      currency === "EUR"
        ? Math.max(1, Math.round(bankroll.currentCapital * safePct * 10) / 10)
        : Math.max(200, Math.round((bankroll.currentCapital * safePct) / 100) * 100);
    return {
      pct: Math.round(safePct * 1000) / 10,
      amount: suggestedAmount,
    };
  }, [couponSummary, coupon.length, bankroll.currentCapital, currency]);

  const recordBetOutcome = (won) => {
    if (!couponSummary || coupon.length === 0) {
      if (showToast) showToast("Ajoutez ou générez d'abord un ticket pour enregistrer son résultat.");
      return;
    }
    const s = Number(stake) || 0;
    const netDelta = won ? s * couponSummary.combinedBookOdd - s : -s;
    const newBal = Math.max(0, Math.round((bankroll.currentCapital + netDelta) * 100) / 100);
    const entry = {
      id: Date.now(),
      date: new Date().toLocaleDateString("fr-FR"),
      label: `Combiné ${coupon.length} match(s) @${couponSummary.combinedBookOdd.toFixed(2)}`,
      stake: s,
      odd: couponSummary.combinedBookOdd,
      status: won ? "won" : "lost",
      delta: netDelta,
      balanceAfter: newBal,
    };
    saveBankroll({
      ...bankroll,
      currentCapital: newBal,
      ledger: [entry, ...bankroll.ledger].slice(0, 40),
    });
    if (showToast) {
      showToast(
        won
          ? `💰 Ticket validé GAGNÉ (+${fmtMoney(netDelta)}) ! Capital mis à jour.`
          : `📉 Ticket comptabilisé (${fmtMoney(netDelta)}) dans votre Bankroll.`
      );
    }
  };

  const profit = bankroll.currentCapital - bankroll.initialCapital;
  const roiPct =
    bankroll.initialCapital > 0
      ? Math.round((profit / bankroll.initialCapital) * 1000) / 10
      : 0;
  const winsCount = bankroll.ledger.filter((x) => x.status === "won").length;
  const winRate =
    bankroll.ledger.length > 0 ? Math.round((winsCount / bankroll.ledger.length) * 100) : null;

  // Courbe SVG de progression du capital
  const chartPoints = useMemo(() => {
    const series = [
      bankroll.initialCapital,
      ...[...bankroll.ledger].reverse().map((x) => x.balanceAfter),
    ];
    if (series.length < 2) return "";
    const minV = Math.min(...series) * 0.95;
    const maxV = Math.max(...series) * 1.05 || 1;
    const span = Math.max(1, maxV - minV);
    return series
      .map((v, idx) => {
        const x = (idx / (series.length - 1)) * 320;
        const y = 70 - ((v - minV) / span) * 58;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [bankroll]);

  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 18 }}>
      {/* 1. GÉNÉRATEUR AUTOMATIQUE DES 3 MEILLEURS TICKETS DU JOUR */}
      <div className="fai-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17 }}>
              ⚡ Générateur Automatique des 3 Meilleurs Tickets IA du Jour
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8e98c2" }}>
              Sélectionnés automatiquement par l&apos;IA parmi les matchs programmés et calibrés selon votre profil de risque :
            </p>
          </div>
          {coupon.length > 0 && couponSummary && (
            <button
              type="button"
              className="fai-btn-secondary"
              onClick={() => {
                exportCouponAsPngImage({
                  coupon,
                  stake,
                  currency,
                  totalOdd: couponSummary.combinedBookOdd,
                  winProbPct: couponSummary.combinedProbPct,
                  potentialGain: couponSummary.potentialPayout,
                });
                if (showToast) showToast("📸 Image HD du Ticket téléchargée en PNG !");
              }}
            >
              📸 Télécharger le Ticket en Image HD (PNG)
            </button>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))",
            gap: 12,
            marginTop: 14,
          }}
        >
          {autoTickets.map((t) => {
            const suggestedBet =
              currency === "EUR"
                ? Math.max(1, Math.round((bankroll.currentCapital * t.recommendedBankrollPct) / 100))
                : Math.max(
                    200,
                    Math.round((bankroll.currentCapital * t.recommendedBankrollPct) / 100 / 100) * 100
                  );
            return (
              <div
                key={t.id}
                style={{
                  background: "rgba(255,255,255,0.035)",
                  border: `1px solid ${t.accent}55`,
                  borderRadius: 14,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: t.accent }}>{t.badge}</span>
                    <span style={{ fontSize: 16, fontWeight: 900, color: "#fbbf24" }}>
                      @{t.totalOdd.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4 }}>
                    {t.title}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>{t.subtitle}</div>

                  <div style={{ display: "grid", gap: 4, fontSize: 11.5, color: "#cbd5e1" }}>
                    {t.items.map((it) => (
                      <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          • {it.home}-{it.away} : <strong>{it.selectedMarket.label}</strong>
                        </span>
                        <span style={{ color: t.accent, fontWeight: 800 }}>{it.selectedMarket.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                    Probabilité combinée IA : <strong style={{ color: "#fff" }}>{t.winProbPct}%</strong> • Mise conseillée ({t.recommendedBankrollPct}%) :{" "}
                    <strong style={{ color: t.accent }}>{fmtMoney(suggestedBet)}</strong>
                  </div>
                  <button
                    type="button"
                    className="fai-btn-secondary"
                    style={{ width: "100%" }}
                    onClick={() => onLoadGeneratedTicket(t.items, suggestedBet, t.badge)}
                  >
                    ⚡ Charger ce Ticket dans mon Coupon
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. GESTIONNAIRE DE BANKROLL PRO & ANTI-RUINE KELLY */}
      <div className="fai-panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              💼 Portefeuille Intelligent &amp; Suivi de Bankroll ({currency})
            </h3>
            <div style={{ fontSize: 12, color: "#8e98c2", marginTop: 2 }}>
              Protection mathématique du capital (Critère de Kelly ¼) &amp; historique réel de rentabilité.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Capital de départ :</span>
            <input
              type="number"
              min="1"
              value={bankroll.initialCapital}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value) || 0);
                saveBankroll({
                  ...bankroll,
                  initialCapital: v,
                  currentCapital: bankroll.ledger.length === 0 ? v : bankroll.currentCapital,
                });
              }}
              className="fai-input"
              style={{ width: 115, padding: "6px 10px" }}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
            marginTop: 12,
          }}
        >
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>CAPITAL ACTUEL</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#00e5ff" }}>
              {fmtMoney(bankroll.currentCapital)}
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>BÉNÉFICE NET</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: profit >= 0 ? "#00e676" : "#ff5252" }}>
              {profit >= 0 ? `+${fmtMoney(profit)}` : fmtMoney(profit)}
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>RENTABILITÉ (ROI)</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: roiPct >= 0 ? "#00e676" : "#ff5252" }}>
              {roiPct >= 0 ? `+${roiPct}%` : `${roiPct}%`}
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>TICKETS GAGNÉS</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fbbf24" }}>
              {winRate !== null ? `${winRate}% (${winsCount}/${bankroll.ledger.length})` : "0 joué"}
            </div>
          </div>
        </div>

        {/* Barre d'actions Kelly + Bilan Ticket */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 12,
          }}
        >
          {kellyStakeInfo && (
            <button
              type="button"
              className="fai-btn-ghost"
              onClick={() => onApplyRecommendedStake(kellyStakeInfo.amount)}
            >
              🛡️ Appliquer la mise idéale Kelly ({kellyStakeInfo.pct}% = {fmtMoney(kellyStakeInfo.amount)})
            </button>
          )}

          {coupon.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="fai-btn-secondary"
                onClick={() => recordBetOutcome(true)}
              >
                ✅ Ticket Gagné (+ Bankroll)
              </button>
              <button
                type="button"
                className="fai-btn-ghost"
                onClick={() => recordBetOutcome(false)}
              >
                ❌ Ticket Perdu (− Mise)
              </button>
            </div>
          )}
        </div>

        {/* Courbe SVG de progression de la Bankroll */}
        {chartPoints && (
          <div style={{ marginTop: 12, background: "rgba(0,0,0,0.28)", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
              📈 Courbe réelle d&apos;évolution de votre Bankroll :
            </div>
            <svg viewBox="0 0 320 76" style={{ width: "100%", height: 74 }}>
              <polyline
                fill="none"
                stroke="#00e676"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={chartPoints}
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
