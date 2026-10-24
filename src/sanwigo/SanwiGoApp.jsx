import React, { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView.jsx";
import {
  POIS, INTERCITY, PASSENGER_CLASSES, DELIVERY_CLASSES, PAYMENT_METHODS,
  PROMOS, DRIVERS_SEED, DEMAND_ZONES, DEFAULT_SETTINGS, SUPPORT,
} from "./data.js";
import {
  computeFare, matchDriver, formatFCFA, surgeForHour, generateRidePin,
  simulateDriverIncome, cancellationFee, haversineKm, getClassById,
} from "./engine.js";

const poiById = (id) => POIS.find((p) => p.id === id) || null;
const LS_RIDES = "sanwigo_rides_v1";
const LS_SETTINGS = "sanwigo_settings_v1";

function loadLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } }

export default function SanwiGoApp() {
  const [role, setRole] = useState("client");
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...loadLS(LS_SETTINGS, {}) }));
  const [drivers, setDrivers] = useState(DRIVERS_SEED);
  const [history, setHistory] = useState(() => loadLS(LS_RIDES, []));
  const [sosAlerts, setSosAlerts] = useState([]);
  const [toast, setToast] = useState("");
  const toastRef = useRef(null);

  // ---- Client state --------------------------------------------------------
  const [mode, setMode] = useState("course"); // course | livraison | interville
  const [fromId, setFromId] = useState("commerce");
  const [toId, setToId] = useState("chr");
  const [stopId, setStopId] = useState("");
  const [classId, setClassId] = useState("eco");
  const [deliveryClassId, setDeliveryClassId] = useState("moto");
  const [intercityId, setIntercityId] = useState("abidjan");
  const [payment, setPayment] = useState("wave");
  const [promoInput, setPromoInput] = useState("BIENVENUE30");
  const [repereLibre, setRepereLibre] = useState("");
  const [pourProche, setPourProche] = useState(false);
  const [procheNom, setProcheNom] = useState("");
  const [programmee, setProgrammee] = useState(false);
  const [dateHeure, setDateHeure] = useState("");
  const [colisDesc, setColisDesc] = useState("Sac de vivriers du marché");
  const [colisPoids, setColisPoids] = useState("8");
  const [destinataire, setDestinataire] = useState("");
  const [search, setSearch] = useState("");
  const [showSafety, setShowSafety] = useState(false);
  const [showImprovements, setShowImprovements] = useState(false);

  // ---- Ride state machine (partagée client / chauffeur / admin) -----------
  const [ride, setRide] = useState(null);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [rating, setRating] = useState(5);
  const [tip, setTip] = useState(0);
  const [pinInputDriver, setPinInputDriver] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [chatLog, setChatLog] = useState([]);

  // ---- Driver state ---------------------------------------------------------
  const [myDriverId, setMyDriverId] = useState("d1");
  const [simCourses, setSimCourses] = useState(12);
  const [simPrix, setSimPrix] = useState(1200);

  const showToast = (m) => {
    setToast(m);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(""), 3800);
  };
  useEffect(() => saveLS(LS_SETTINGS, settings), [settings]);
  useEffect(() => saveLS(LS_RIDES, history), [history]);

  const nowHour = new Date().getHours();
  const surgeNow = surgeForHour(nowHour, settings.plafondPointe);
  const fromPoi = poiById(fromId);
  const toPoi = poiById(toId);
  const stopPoi = stopId ? poiById(stopId) : null;
  const intercity = INTERCITY.find((i) => i.id === intercityId) || null;
  const activeClassId = mode === "livraison" ? deliveryClassId : classId;

  const fare = useMemo(() => {
    if (!fromPoi) return null;
    if (mode === "interville") {
      return computeFare({ from: fromPoi, to: toPoi || fromPoi, classId, settings, promoCode: promoInput, hour: nowHour, intercity });
    }
    if (!toPoi || toId === fromId) return null;
    return computeFare({ from: fromPoi, to: toPoi, stops: stopPoi ? [stopPoi] : [], classId: activeClassId, settings, promoCode: promoInput, hour: nowHour });
  }, [fromPoi, toPoi, stopPoi, fromId, toId, activeClassId, classId, settings, promoInput, mode, intercity, nowHour]);

  const fareByClass = (cid) => {
    if (!fromPoi || (mode !== "interville" && (!toPoi || toId === fromId))) return null;
    return computeFare({
      from: fromPoi, to: toPoi || fromPoi, stops: stopPoi ? [stopPoi] : [], classId: cid,
      settings, promoCode: promoInput, hour: nowHour, intercity: mode === "interville" ? intercity : null,
    });
  };

  // ---- Timer machine --------------------------------------------------------
  useEffect(() => {
    if (!ride) return undefined;
    if (ride.phase === "searching") {
      const t = setTimeout(() => setRide((r) => (r ? { ...r, phase: "to_pickup", progress: 0 } : r)), 2600);
      return () => clearTimeout(t);
    }
    if (ride.phase === "to_pickup" || ride.phase === "in_progress") {
      const iv = setInterval(() => {
        setRide((r) => {
          if (!r) return r;
          const next = Math.min(1, (r.progress || 0) + 0.045);
          if (next >= 1 && r.phase === "to_pickup") return { ...r, progress: 1, phase: "arrived" };
          if (next >= 1 && r.phase === "in_progress") return { ...r, progress: 1, phase: "completed" };
          return { ...r, progress: next };
        });
      }, 420);
      return () => clearInterval(iv);
    }
    if (ride.phase === "completed" && !ride.credited) {
      setRide((r) => (r ? { ...r, credited: true } : r));
      setDrivers((ds) => ds.map((d) => (d.id === ride.driverId ? { ...d, gainsJour: d.gainsJour + ride.fare.netChauffeur, courses: d.courses + 1, fileDepuisMin: 0 } : d)));
      const rec = { ...ride, completedAt: new Date().toISOString() };
      setHistory((h) => [rec, ...h].slice(0, 50));
      setLastReceipt(rec);
      showToast("🏁 Course terminée — merci ! Notez votre chauffeur.");
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride && ride.phase, ride && ride.id]);

  const orderRide = () => {
    if (programmee) {
      if (!dateHeure) return showToast("⏰ Choisissez la date et l'heure de réservation.");
      showToast(`📅 Réservation enregistrée pour le ${new Date(dateHeure).toLocaleString("fr-FR")} — nous affecterons un chauffeur 30 min avant.`);
      setHistory((h) => [{ id: "resa-" + Date.now(), phase: "programmee", dateHeure, fromId, toId, mode, classId: activeClassId, fare, createdAt: new Date().toISOString() }, ...h]);
      return;
    }
    if (!fare) return showToast("📍 Choisissez un départ et une destination différents.");
    if (mode === "livraison" && (!colisDesc || !destinataire)) return showToast("📦 Décrivez le colis et le téléphone du destinataire.");
    const match = matchDriver(drivers, activeClassId, fromPoi, POIS);
    if (!match) return showToast("😕 Aucun chauffeur disponible dans cette classe pour le moment. Essayez Éco ou réessayez dans 2 min.");
    setLastReceipt(null);
    setChatLog([]);
    setRide({
      id: "SG-" + Date.now().toString().slice(-6),
      phase: "searching", progress: 0, credited: false,
      mode, classId: activeClassId, fromId, toId: mode === "interville" ? intercityId : toId, stopId,
      fromNom: fromPoi.nom, toNom: mode === "interville" ? intercity.nom : toPoi.nom,
      fare, payment, driverId: match.driver.id, etaMin: match.etaMin,
      pin: generateRidePin(),
      acceptedAtMin: 0,
      createdAt: new Date().toISOString(),
      pourProche, procheNom, repereLibre,
      colis: mode === "livraison" ? { desc: colisDesc, poids: colisPoids, destinataire } : null,
    });
    showToast("🔎 Recherche du meilleur chauffeur près de vous…");
  };

  const cancelRide = () => {
    if (!ride) return;
    const mins = ride.phase === "searching" ? 0 : 3; // démo : après acceptation
    const frais = cancellationFee(mins, settings);
    showToast(frais === 0 ? "✅ Annulation gratuite (dans les 2 premières minutes)." : `Course annulée — frais ${formatFCFA(frais)} selon la règle affichée (après 2 min).`);
    setRide(null);
  };

  const startTripWithPin = (pin) => {
    if (!ride) return;
    if (pin !== ride.pin) return showToast("🔐 PIN incorrect — demandez le code à 4 chiffres au client.");
    setRide((r) => ({ ...r, phase: "in_progress", progress: 0 }));
    showToast("▶️ PIN correct — bon voyage !");
  };

  const rateRide = () => {
    showToast(`⭐ Merci ! Note ${rating}/5${tip ? ` + pourboire ${formatFCFA(tip)}` : ""} — +10 points Sanwi sur votre compte.`);
    if (tip) setDrivers((ds) => ds.map((d) => (d.id === ride.driverId ? { ...d, gainsJour: d.gainsJour + tip } : d)));
    setRide(null); setTip(0); setRating(5);
  };

  const triggerSOS = () => {
    const alert = { id: Date.now(), at: new Date().toLocaleTimeString("fr-FR"), rideId: ride ? ride.id : "—", lieu: fromPoi ? fromPoi.nom : "Aboisso" };
    setSosAlerts((a) => [alert, ...a]);
    showToast("🆘 SOS envoyé : position partagée au support SanwiGo et à votre contact d'urgence. Police 170 / Pompiers 180.");
  };

  const geolocateMe = () => {
    if (!navigator.geolocation) return showToast("GPS non disponible sur cet appareil — choisissez votre repère dans la liste.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        let best = POIS[0]; let bd = 1e9;
        POIS.forEach((p) => { const d = haversineKm(me, p); if (d < bd) { bd = d; best = p; } });
        setFromId(best.id);
        showToast(`📍 Position détectée — repère le plus proche : ${best.nom} (à ~${bd < 1 ? Math.round(bd * 1000) + " m" : bd.toFixed(1) + " km"}).`);
      },
      () => showToast("📍 GPS refusé — aucun souci : choisissez votre repère, le chauffeur vous appellera."),
      { timeout: 8000 }
    );
  };

  const matchedDriver = ride ? drivers.find((d) => d.id === ride.driverId) : null;
  const myDriver = drivers.find((d) => d.id === myDriverId);
  const ridePhaseForMap = !ride ? "idle" : ride.phase === "searching" ? "idle" : ride.phase;
  const pointsSanwi = history.filter((h) => h.phase !== "programmee").length * 10;

  const filteredPois = POIS.filter((p) => (p.nom + p.quartier + p.repere).toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="sg-app">
      <header className="sg-header">
        <div className="sg-brand">
          <div className="sg-logo">👑</div>
          <div>
            <div className="sg-name">Sanwi<span>Go</span></div>
            <div className="sg-tag">Akwaba à Aboisso — on vous y conduit 🚖</div>
          </div>
        </div>
        <div className="sg-head-right">
          <span className="sg-badge">{surgeNow > 1 ? `⏰ Heure de pointe x${surgeNow} (plafond x${settings.plafondPointe})` : "✅ Tarif normal"}</span>
          <span className="sg-badge sg-badge-gold">⭐ {pointsSanwi} pts Sanwi</span>
          <a className="sg-badge sg-link" href="/">⚽ Football AI</a>
        </div>
      </header>

      <nav className="sg-roles" aria-label="Changer d'espace">
        {[["client", "🧍 Client"], ["chauffeur", "🚖 Chauffeur Pro"], ["admin", "🛠️ Admin"]].map(([id, label]) => (
          <button key={id} className={role === id ? "sg-role active" : "sg-role"} onClick={() => setRole(id)}>{label}</button>
        ))}
      </nav>

      {toast && <div className="sg-toast">{toast}</div>}

      {role === "client" && (
        <main className="sg-grid">
          <section className="sg-mapcol">
            <MapView
              fromId={fromId} toId={mode === "interville" ? fromId : toId} stopId={stopId}
              drivers={drivers} ridePhase={ridePhaseForMap} rideProgress={ride ? ride.progress || 0 : 0}
              matchedDriverId={ride ? ride.driverId : null}
              onPickPoi={(id) => { if (mode !== "interville") { setToId(id); showToast(`🎯 Destination : ${poiById(id).nom}`); } }}
            />
            <RideTracker ride={ride} driver={matchedDriver} onCancel={cancelRide} onStart={startTripWithPin}
              onRate={rateRide} rating={rating} setRating={setRating} tip={tip} setTip={setTip}
              chatLog={chatLog} chatMsg={chatMsg} setChatMsg={setChatMsg}
              sendChat={() => { if (!chatMsg.trim()) return; setChatLog((l) => [...l, { from: "Moi", text: chatMsg }, { from: matchedDriver ? matchedDriver.nom.split(" ")[0] : "Chauffeur", text: "Bien reçu ! J'arrive au repère indiqué. 🙏" }]); setChatMsg(""); }}
              onSOS={triggerSOS} showSafety={showSafety} setShowSafety={setShowSafety} payment={payment} />
            {lastReceipt && !ride && <Receipt rec={lastReceipt} drivers={drivers} />}
          </section>

          <section className="sg-panel">
            <div className="sg-modes">
              {[["course", "🚖 Course"], ["livraison", "📦 Livraison"], ["interville", "🛣️ Inter-villes"]].map(([id, label]) => (
                <button key={id} className={mode === id ? "sg-mode active" : "sg-mode"} onClick={() => setMode(id)} disabled={!!ride}>{label}</button>
              ))}
            </div>
            {mode === "livraison" && <div className="sg-note">🛡️ <b>Sécurité :</b> moto, tricycle et camion transportent <b>uniquement des colis</b> — jamais de passager. Les personnes voyagent en voiture.</div>}

            <label className="sg-label">📍 Départ (repère)</label>
            <div className="sg-row">
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} disabled={!!ride}>
                {POIS.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.nom}</option>)}
              </select>
              <button className="sg-btn sg-btn-ghost" onClick={geolocateMe} type="button">🎯 GPS</button>
            </div>
            {fromPoi && <div className="sg-repere">🧭 Repère chauffeur : <b>{fromPoi.repere}</b></div>}
            <input className="sg-input" placeholder="Précisez si besoin : ex. « devant le maquis bleu, je porte un pagne orange »" value={repereLibre} onChange={(e) => setRepereLibre(e.target.value)} disabled={!!ride} />

            {mode === "interville" ? (
              <>
                <label className="sg-label">🛣️ Ville de destination (forfait voiture privée)</label>
                <div className="sg-inter-list">
                  {INTERCITY.map((c) => (
                    <button key={c.id} className={intercityId === c.id ? "sg-inter active" : "sg-inter"} onClick={() => setIntercityId(c.id)} disabled={!!ride}>
                      <b>{c.nom}</b><span>{c.distanceKm} km · ~{c.dureeMin} min</span><span className="sg-inter-price">dès {formatFCFA(c.forfaitEco)}</span><small>{c.note}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <label className="sg-label">🎯 Destination</label>
                <input className="sg-input" placeholder="🔎 Rechercher un lieu, un quartier, un repère…" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!!ride} />
                {search && (
                  <div className="sg-search-results">
                    {filteredPois.slice(0, 6).map((p) => (
                      <button key={p.id} onClick={() => { setToId(p.id); setSearch(""); }}>{p.icon} <b>{p.nom}</b> <small>— {p.repere}</small></button>
                    ))}
                    {filteredPois.length === 0 && <div className="sg-empty">Aucun lieu — appelez-nous, on vous trouve ! 📞</div>}
                  </div>
                )}
                <select value={toId} onChange={(e) => setToId(e.target.value)} disabled={!!ride}>
                  {POIS.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.nom}</option>)}
                </select>
                <div className="sg-chips">
                  <button onClick={() => setToId("sokoura")} disabled={!!ride}>🏠 Maison</button>
                  <button onClick={() => setToId("mairie")} disabled={!!ride}>💼 Travail</button>
                  {POIS.filter((p) => p.populaire).map((p) => <button key={p.id} onClick={() => setToId(p.id)} disabled={!!ride}>{p.icon} {p.nom.replace(" d'Aboisso", "")}</button>)}
                </div>
                <label className="sg-check"><input type="checkbox" checked={!!stopId} onChange={(e) => setStopId(e.target.checked ? "marche" : "")} disabled={!!ride} /> ➕ Ajouter un arrêt (récupérer quelqu'un, course au marché…)</label>
                {stopId && (
                  <select value={stopId} onChange={(e) => setStopId(e.target.value)} disabled={!!ride}>
                    {POIS.filter((p) => p.id !== fromId && p.id !== toId).map((p) => <option key={p.id} value={p.id}>Arrêt : {p.icon} {p.nom}</option>)}
                  </select>
                )}
              </>
            )}

            {mode === "livraison" && (
              <div className="sg-box">
                <label className="sg-label">📦 Colis</label>
                <input className="sg-input" value={colisDesc} onChange={(e) => setColisDesc(e.target.value)} placeholder="Description du colis" disabled={!!ride} />
                <div className="sg-row">
                  <input className="sg-input" value={colisPoids} onChange={(e) => setColisPoids(e.target.value)} placeholder="Poids (kg)" inputMode="numeric" disabled={!!ride} />
                  <input className="sg-input" value={destinataire} onChange={(e) => setDestinataire(e.target.value)} placeholder="📱 Tél. du destinataire" inputMode="tel" disabled={!!ride} />
                </div>
                <div className="sg-note">Le destinataire reçoit un <b>code de livraison</b> à donner au livreur — preuve de remise.</div>
              </div>
            )}

            <label className="sg-label">{mode === "livraison" ? "🚚 Véhicule de livraison" : "🚗 Choisir la voiture"} <small>(prix fixe garanti, détail ci-dessous)</small></label>
            <div className="sg-classes">
              {(mode === "livraison" ? DELIVERY_CLASSES : PASSENGER_CLASSES).map((c) => {
                const f = fareByClass(c.id);
                const sel = (mode === "livraison" ? deliveryClassId : classId) === c.id;
                const m = fromPoi ? matchDriver(drivers, c.id, fromPoi, POIS) : null;
                return (
                  <button key={c.id} className={sel ? "sg-class active" : "sg-class"} disabled={!!ride}
                    onClick={() => (mode === "livraison" ? setDeliveryClassId(c.id) : setClassId(c.id))}>
                    <span className="sg-class-icon">{c.icon}</span>
                    <span className="sg-class-main"><b>{c.nom}</b><small>{c.desc}{c.places ? ` · ${c.places}` : ""}{c.charges ? ` · ${c.charges}` : ""}</small><small>{c.exemples || ""}</small></span>
                    <span className="sg-class-price">{f ? formatFCFA(f.total) : "—"}<small>{m ? ` · ${m.etaMin} min` : " · indisponible"}</small></span>
                  </button>
                );
              })}
            </div>

            {toPoi && toPoi.piste && mode === "course" && classId !== "piste" && (
              <div className="sg-note sg-warn">🌧️ Destination village/piste : en saison des pluies, la classe <b>Villages &amp; Pistes 🚙</b> est conseillée.</div>
            )}

            <div className="sg-row">
              <div className="sg-grow">
                <label className="sg-label">💳 Paiement</label>
                <div className="sg-pays">
                  {PAYMENT_METHODS.map((p) => (
                    <button key={p.id} className={payment === p.id ? "sg-pay active" : "sg-pay"} onClick={() => setPayment(p.id)} disabled={!!ride}>{p.icon} {p.nom}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="sg-row">
              <input className="sg-input sg-grow" placeholder="Code promo (essayez BIENVENUE30)" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} disabled={!!ride} />
              <span className="sg-promo-hint">{Object.values(PROMOS).map((p) => p.code).join(" · ")}</span>
            </div>

            <label className="sg-check"><input type="checkbox" checked={pourProche} onChange={(e) => setPourProche(e.target.checked)} disabled={!!ride} /> 🙋 Commander pour un proche (parent, visiteur…)</label>
            {pourProche && <input className="sg-input" placeholder="Nom + téléphone du proche à prendre en charge" value={procheNom} onChange={(e) => setProcheNom(e.target.value)} disabled={!!ride} />}
            <label className="sg-check"><input type="checkbox" checked={programmee} onChange={(e) => setProgrammee(e.target.checked)} disabled={!!ride} /> 📅 Réserver pour plus tard</label>
            {programmee && <input type="datetime-local" className="sg-input" value={dateHeure} onChange={(e) => setDateHeure(e.target.value)} disabled={!!ride} />}

            {fare ? <FareDetail fare={fare} settings={settings} cls={getClassById(activeClassId)} /> : <div className="sg-empty">Choisissez une destination différente du départ pour voir le prix fixe.</div>}

            <button className="sg-btn sg-btn-main" onClick={orderRide} disabled={!!ride || !fare}>
              {programmee ? "📅 Confirmer la réservation" : mode === "livraison" ? `📦 Envoyer le colis — ${fare ? formatFCFA(fare.total) : ""}` : `👑 Commander SanwiGo — ${fare ? formatFCFA(fare.total) : ""}`}
            </button>
            <div className="sg-alt-order">
              <span>Pas de smartphone / réseau faible ?</span>
              <a href="tel:+2252721300000">📞 Appeler</a>
              <a href={`https://wa.me/?text=${encodeURIComponent("Akwaba SanwiGo ! Je suis à " + (fromPoi ? fromPoi.nom : "Aboisso") + ", je vais à " + (mode === "interville" ? intercity.nom : toPoi ? toPoi.nom : ""))}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>
              <span className="sg-ussd">📲 USSD : <b>*144*9#</b> <small>(code démo)</small></span>
            </div>

            <button className="sg-btn sg-btn-ghost sg-full" onClick={() => setShowImprovements((v) => !v)}>{showImprovements ? "▲ Masquer" : "💡 Quelles failles des gros VTC avons-nous corrigées ?"}</button>
            {showImprovements && <Improvements settings={settings} />}

            <h3 className="sg-h3">🧾 Mes courses</h3>
            {history.length === 0 ? <div className="sg-empty">Aucune course pour le moment — la 1ʳᵉ est à -30% avec BIENVENUE30 🎁</div> :
              history.slice(0, 8).map((h) => (
                <div className="sg-hist" key={h.id}>
                  <span>{h.phase === "programmee" ? "📅" : "🚖"} <b>{h.fromNom || poiById(h.fromId)?.nom || h.fromId}</b> → <b>{h.toNom || poiById(h.toId)?.nom || INTERCITY.find((i) => i.id === h.toId)?.nom || h.toId}</b></span>
                  <span>{h.fare ? formatFCFA(h.fare.total) : ""} <small>{new Date(h.createdAt).toLocaleDateString("fr-FR")}</small></span>
                </div>
              ))}
          </section>
        </main>
      )}

      {role === "chauffeur" && (
        <DriverView
          drivers={drivers} setDrivers={setDrivers} myDriver={myDriver} myDriverId={myDriverId} setMyDriverId={setMyDriverId}
          ride={ride} settings={settings} pinInput={pinInputDriver} setPinInput={setPinInputDriver}
          onStart={startTripWithPin} onToast={showToast}
          simCourses={simCourses} setSimCourses={setSimCourses} simPrix={simPrix} setSimPrix={setSimPrix}
          setRide={setRide}
        />
      )}

      {role === "admin" && (
        <AdminView drivers={drivers} setDrivers={setDrivers} settings={settings} setSettings={setSettings}
          history={history} ride={ride} sosAlerts={sosAlerts} onToast={showToast} />
      )}

      <footer className="sg-footer">
        <div>👑 <b>SanwiGo</b> — {SUPPORT.agence} · 📞 {SUPPORT.telAffiche} · 💬 WhatsApp {SUPPORT.whatsappAffiche}</div>
        <div className="sg-legal">Marque et code 100% propres (reconstruits à partir des usages publics du VTC, aucun actif Yango). Prototype de démonstration : lancement réel soumis à autorisation VTC (ARTI, décret n°2021-860), assurances et accords Mobile Money. Voir <b>SANWIGO.md</b>.</div>
      </footer>
    </div>
  );
}

// ============================== Sous-composants ==============================

function FareDetail({ fare, settings, cls }) {
  return (
    <div className="sg-fare">
      <div className="sg-fare-head"><span>🧾 Prix fixe garanti — {cls ? cls.nom : ""}</span><b>{formatFCFA(fare.total)}</b></div>
      <div className="sg-fare-meta">📏 ~{fare.distanceKm} km · ⏱️ ~{fare.durationMin} min{fare.minimumApplique ? " · tarif minimum appliqué" : ""}</div>
      {fare.mode === "ville" ? (
        <>
          <Line k="Prise en charge" v={fare.base} />
          <Line k={`Distance (${cls.parKm} F/km)`} v={fare.distCost} />
          <Line k={`Temps (${cls.parMin} F/min)`} v={fare.timeCost} />
          {fare.surgeMontant > 0 && <Line k={`Heure de pointe x${fare.surgeCoef} (plafond x${settings.plafondPointe})`} v={fare.surgeMontant} />}
        </>
      ) : <Line k="Forfait inter-villes (tout inclus)" v={fare.base} />}
      {fare.remise > 0 && <Line k={`Promo ${fare.promoAppliquee} 🎁`} v={-fare.remise} />}
      {fare.promoRefusee && <div className="sg-fare-line sg-red"><span>Code « {fare.promoRefusee} » inconnu</span><span>0</span></div>}
      <div className="sg-fare-line sg-fare-driver"><span>🚖 Le chauffeur reçoit (commission {fare.commissionPct}% seulement)</span><b>{formatFCFA(fare.netChauffeur)}</b></div>
      <div className="sg-fare-note">✅ Ce prix ne changera pas en route. Attente : {settings.attenteGratuiteMin} min gratuites puis {settings.attenteParMin} F/min. Annulation gratuite {settings.annulationGratuiteMin} min.</div>
    </div>
  );
}
function Line({ k, v }) { return <div className="sg-fare-line"><span>{k}</span><span>{v < 0 ? "− " : ""}{formatFCFA(Math.abs(v))}</span></div>; }

function RideTracker({ ride, driver, onCancel, onStart, onRate, rating, setRating, tip, setTip, chatLog, chatMsg, setChatMsg, sendChat, onSOS, showSafety, setShowSafety, payment }) {
  if (!ride) return null;
  const cls = getClassById(ride.classId);
  const steps = [
    ["searching", "🔎 Recherche"], ["to_pickup", "🚖 En route vers vous"], ["arrived", "📍 Chauffeur arrivé"],
    ["in_progress", "🛣️ Course en cours"], ["completed", "🏁 Arrivé"],
  ];
  const idx = steps.findIndex(([id]) => id === ride.phase);
  const shareText = encodeURIComponent(`👑 SanwiGo : je suis en course ${ride.id} de ${ride.fromNom} vers ${ride.toNom}${driver ? ` avec ${driver.nom} (${driver.vehicule}, plaque ${driver.plaque})` : ""}. Suivez-moi !`);
  return (
    <div className="sg-live">
      <div className="sg-steps">{steps.map(([id, label], i) => <span key={id} className={i <= idx ? "sg-step on" : "sg-step"}>{label}</span>)}</div>
      {(ride.phase === "to_pickup" || ride.phase === "in_progress") && (
        <div className="sg-progress"><div style={{ width: `${Math.round((ride.progress || 0) * 100)}%` }} /></div>
      )}
      {ride.phase === "searching" && <div className="sg-searching">🔎 On cherche le chauffeur le plus proche et le mieux noté… <span className="sg-dots">• • •</span></div>}
      {driver && ride.phase !== "searching" && (
        <div className="sg-driver-card">
          <div className="sg-avatar">{driver.nom.split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
          <div className="sg-driver-info">
            <b>{driver.nom}</b> <span className="sg-note-badge">⭐ {driver.note} · {driver.courses} courses</span>
            <div>{driver.vehicule} · <b className="sg-plate">{driver.plaque}</b></div>
            <div>{cls ? cls.icon + " " + cls.nom : ""} · {formatFCFA(ride.fare.total)} · {PAYMENT_METHODS.find((p) => p.id === payment)?.nom}</div>
            {ride.phase === "to_pickup" && <div>⏱️ Arrivée estimée : <b>{ride.etaMin} min</b> — soyez au repère indiqué</div>}
          </div>
        </div>
      )}
      {ride.phase === "arrived" && (
        <div className="sg-pin">
          🔐 <b>Votre code de course : <span className="sg-pin-code">{ride.pin}</span></b><br />
          Donnez-le au chauffeur uniquement quand vous êtes dans la bonne voiture (vérifiez la plaque).
          <div className="sg-row"><input className="sg-input" placeholder="Démo sur 1 téléphone : saisissez le PIN ici" inputMode="numeric" id="pinClient" /><button className="sg-btn sg-btn-green" onClick={() => onStart(document.getElementById("pinClient").value.trim())}>▶️ Démarrer</button></div>
          <small>Ou passez dans l'onglet « Chauffeur Pro » : c'est lui qui doit saisir ce code.</small>
        </div>
      )}
      {ride.phase === "completed" ? (
        <div className="sg-rating">
          <div>🏁 Vous êtes arrivé — {formatFCFA(ride.fare.total)} ({PAYMENT_METHODS.find((p) => p.id === payment)?.nom})</div>
          <div className="sg-stars">{[1, 2, 3, 4, 5].map((s) => <button key={s} className={s <= rating ? "on" : ""} onClick={() => setRating(s)}>★</button>)}</div>
          <div className="sg-chips"><span>Pourboire :</span>{[0, 100, 200, 500].map((t) => <button key={t} className={tip === t ? "active" : ""} onClick={() => setTip(t)}>{t ? formatFCFA(t) : "Non"}</button>)}</div>
          <button className="sg-btn sg-btn-main" onClick={onRate}>⭐ Valider et terminer</button>
        </div>
      ) : (
        <>
          <div className="sg-actions">
            <a className="sg-btn sg-btn-ghost" href={`https://wa.me/?text=${shareText}`} target="_blank" rel="noreferrer">📤 Partager mon trajet</a>
            <button className="sg-btn sg-btn-ghost" onClick={() => setShowSafety(!showSafety)}>🛡️ Sécurité</button>
            <button className="sg-btn sg-btn-red" onClick={onSOS}>🆘 SOS</button>
            <button className="sg-btn sg-btn-ghost" onClick={onCancel}>✖ Annuler</button>
          </div>
          {showSafety && (
            <div className="sg-safety">
              <b>🛡️ Centre de sécurité</b>
              <ul>
                <li>Vérifiez nom, photo initiale, véhicule et <b>plaque</b> avant de monter.</li>
                <li>Ne donnez le <b>PIN</b> qu'une fois assis dans la voiture.</li>
                <li>Urgences : Police <b>170</b> · Pompiers <b>180</b> · {SUPPORT.urgence}</li>
                <li>Point sûr la nuit à Aboisso : commissariat, gare routière, CHR (éclairés &amp; gardés).</li>
              </ul>
            </div>
          )}
          <div className="sg-chat">
            {chatLog.map((m, i) => <div key={i} className={m.from === "Moi" ? "sg-msg me" : "sg-msg"}><b>{m.from} :</b> {m.text}</div>)}
            <div className="sg-row"><input className="sg-input sg-grow" placeholder="💬 Message au chauffeur (ex. je suis devant la pharmacie)" value={chatMsg} onChange={(e) => setChatMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} /><button className="sg-btn sg-btn-green" onClick={sendChat}>Envoyer</button></div>
            <div className="sg-chips">{["Je suis au repère 📍", "J'arrive dans 2 min", "Appelez-moi 📞"].map((q) => <button key={q} onClick={() => setChatMsg(q)}>{q}</button>)}</div>
          </div>
        </>
      )}
    </div>
  );
}

function Receipt({ rec, drivers }) {
  const d = drivers.find((x) => x.id === rec.driverId);
  return (
    <div className="sg-receipt">
      <b>🧾 Reçu {rec.id}</b> — {rec.fromNom} → {rec.toNom}<br />
      {d ? `${d.nom} · ${d.plaque}` : ""} · Total payé : <b>{formatFCFA(rec.fare.total)}</b> · Chauffeur : {formatFCFA(rec.fare.netChauffeur)} · Commission SanwiGo {rec.fare.commissionPct}% : {formatFCFA(rec.fare.commission)}
      <div><small>Un souci ? {SUPPORT.agence} ou WhatsApp {SUPPORT.whatsappAffiche} sous 7 jours.</small></div>
    </div>
  );
}

function Improvements({ settings }) {
  const items = [
    ["💸 Commission chauffeur", `18-23% chez le leader → ${settings.commissionEcoPct}-${settings.commissionConfortPct}% ici, payée chaque jour par Wave/Orange Money (pas chaque semaine).`],
    ["🔍 Prix opaque & « surge » surprise", `Prix fixe garanti avant de commander, détaillé ligne par ligne, pointe plafonnée à x${settings.plafondPointe}.`],
    ["📍 GPS perdu sans adresse", "Repères parlés d'Aboisso (pharmacie du marché, carrefour TP…) + précision libre + appel chauffeur."],
    ["🏙️ Pense qu'Abidjan", "Tarifs dès 300 FCFA, Wôrô Partagé, villages & pistes, inter-villes Sud-Comoé (Ayamé, Noé, Bonoua…)."],
    ["💳 Paiement carte d'abord", "Wave, Orange Money et MTN MoMo natifs + espèces arrondies à 50 FCFA pratiques."],
    ["🚕 Refus des petites courses", `Bonus course courte ${settings.bonusCourseCourte} FCFA payé au chauffeur + file d'attente équitable à la gare dans l'algorithme.`],
    ["🛡️ Sécurité perfectible", "PIN de course obligatoire, plaque vérifiable, SOS + partage WhatsApp, points sûrs la nuit."],
    ["📶 Réseau faible ignoré", "Carte hors-ligne légère, commande téléphone / WhatsApp / USSD, agence physique à la gare d'Aboisso."],
    ["🙈 Destination cachée au chauffeur", "Le chauffeur voit destination, distance et SON net avant d'accepter — zéro course piège."],
    ["🧺 Marché & récoltes oubliés", "Tricycle marché et camion en livraison (vivriers, matériaux) — moto réservée aux colis, jamais aux passagers."],
  ];
  return <div className="sg-improve">{items.map(([t, d]) => <div key={t} className="sg-improve-item"><b>{t}</b><span>{d}</span></div>)}</div>;
}

function DriverView({ drivers, setDrivers, myDriver, myDriverId, setMyDriverId, ride, settings, pinInput, setPinInput, onStart, onToast, simCourses, setSimCourses, simPrix, setSimPrix, setRide }) {
  if (!myDriver) return null;
  const income = simulateDriverIncome({ coursesParJour: simCourses, prixMoyen: simPrix, commissionPct: settings.commissionEcoPct });
  const patch = (p) => setDrivers((ds) => ds.map((d) => (d.id === myDriverId ? { ...d, ...p } : d)));
  const docsList = [["permis", "Permis B"], ["carteGrise", "Carte grise"], ["assurance", "Assurance"], ["visite", "Visite technique"], ["cni", "CNI"]];
  const myRide = ride && ride.driverId === myDriverId ? ride : null;
  const niveau = myDriver.courses > 1500 ? "👑 Or Sanwi" : myDriver.courses > 700 ? "🥈 Argent" : "🥉 Bronze";
  return (
    <main className="sg-single">
      <div className="sg-card">
        <div className="sg-row sg-spread">
          <div><b className="sg-big">{myDriver.nom}</b><div>{myDriver.vehicule} · <b className="sg-plate">{myDriver.plaque}</b></div><div>⭐ {myDriver.note} · {myDriver.courses} courses · {niveau}</div></div>
          <button className={myDriver.enLigne ? "sg-btn sg-btn-green" : "sg-btn sg-btn-red"} onClick={() => { patch({ enLigne: !myDriver.enLigne }); onToast(myDriver.enLigne ? "🔴 Vous êtes hors ligne." : "🟢 En ligne — prêt à recevoir des courses à Aboisso !"); }}>
            {myDriver.enLigne ? "🟢 En ligne" : "🔴 Hors ligne"}
          </button>
        </div>
        <div className="sg-row">
          <label className="sg-grow">Compte chauffeur (démo)<select value={myDriverId} onChange={(e) => setMyDriverId(e.target.value)}>{drivers.map((d) => <option key={d.id} value={d.id}>{d.nom} — {d.classes.join("/")}</option>)}</select></label>
          <label className="sg-grow">Ma position<select value={myDriver.poiId} onChange={(e) => patch({ poiId: e.target.value, fileDepuisMin: 0 })}>{POIS.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.nom}</option>)}</select></label>
        </div>
        <div className="sg-kpis">
          <div><b>{formatFCFA(myDriver.gainsJour)}</b><span>Gagnés aujourd'hui </span></div>
          <div><b>{settings.commissionEcoPct}-{settings.commissionConfortPct}%</b><span>Commission (vs 18-23% ailleurs)</span></div>
          <div><b>Chaque jour</b><span>Paiement Wave/Orange Money</span></div>
          <div><b>{myDriver.fileDepuisMin} min</b><span>Dans la file (équité gare)</span></div>
        </div>
      </div>

      {myRide ? (
        <div className="sg-card sg-live">
          <b className="sg-big">📲 Course {myRide.id} — vous voyez TOUT avant de rouler</b>
          <div>📍 {myRide.fromNom} → 🎯 {myRide.toNom}</div>
          <div>📏 {myRide.fare.distanceKm} km · ⏱️ ~{myRide.fare.durationMin} min · Client paie {formatFCFA(myRide.fare.total)} · <b>Votre net : {formatFCFA(myRide.fare.netChauffeur)}</b> (commission {myRide.fare.commissionPct}%)</div>
          {myRide.repereLibre && <div>🧭 Précision client : « {myRide.repereLibre} »</div>}
          {myRide.colis && <div>📦 Colis : {myRide.colis.desc} ({myRide.colis.poids} kg) → destinataire {myRide.colis.destinataire}</div>}
          <div>Phase : <b>{myRide.phase}</b></div>
          {myRide.phase === "arrived" && (
            <div className="sg-row"><input className="sg-input sg-grow" placeholder="🔐 Demandez le PIN au client et saisissez-le" value={pinInput} onChange={(e) => setPinInput(e.target.value)} inputMode="numeric" /><button className="sg-btn sg-btn-green" onClick={() => onStart(pinInput.trim())}>▶️ Démarrer la course</button></div>
          )}
          {myRide.phase === "in_progress" && <button className="sg-btn sg-btn-main" onClick={() => setRide((r) => ({ ...r, progress: 0.99 }))}>🏁 Je suis presque arrivé (démo : terminer)</button>}
          {myRide.phase === "completed" && <div>✅ Course terminée — {formatFCFA(myRide.fare.netChauffeur)} crédités sur vos gains du jour.</div>}
        </div>
      ) : (
        <div className="sg-card">📲 {ride ? "Une course est en cours avec un autre chauffeur (voyez l'onglet Client)." : myDriver.enLigne ? "En attente de course… Commandez dans l'onglet Client avec une classe que vous servez (" + myDriver.classes.join(", ") + ") pour recevoir la demande ici." : "Passez en ligne pour recevoir des courses."}</div>
      )}

      <div className="sg-card">
        <b className="sg-big">🔥 Où il y a du travail à Aboisso maintenant</b>
        {DEMAND_ZONES.map((z) => { const p = poiById(z.poiId); return <div className="sg-hist" key={z.poiId}><span>{p.icon} <b>{p.nom}</b> — {z.conseil}</span><span className="sg-badge sg-badge-gold">{z.niveau} x{z.coef}</span></div>; })}
      </div>

      <div className="sg-card">
        <b className="sg-big">🧮 Combien je gagne avec SanwiGo ?</b>
        <label>Courses / jour : <b>{simCourses}</b><input type="range" min="4" max="25" value={simCourses} onChange={(e) => setSimCourses(+e.target.value)} /></label>
        <label>Prix moyen / course : <b>{formatFCFA(simPrix)}</b><input type="range" min="500" max="3000" step="100" value={simPrix} onChange={(e) => setSimPrix(+e.target.value)} /></label>
        <div className="sg-kpis">
          <div><b>{formatFCFA(income.netJour)}</b><span>Net / jour (carburant déduit)</span></div>
          <div><b>{formatFCFA(income.netSemaine)}</b><span>Net / semaine (6 j)</span></div>
          <div><b>{formatFCFA(income.netMois)}</b><span>Net / mois estimé</span></div>
        </div>
        <div className="sg-note">Avec une commission de 20% au lieu de {settings.commissionEcoPct}%, vous perdriez environ <b>{formatFCFA(simCourses * simPrix * ((20 - settings.commissionEcoPct) / 100) * 26)}</b> par mois. C'est la faille n°1 que SanwiGo corrige.</div>
      </div>

      <div className="sg-card">
        <b className="sg-big">📄 Mes documents (visibles par l'Admin)</b>
        {docsList.map(([k, label]) => (
          <div className="sg-hist" key={k}><span>{myDriver.docs[k] ? "✅" : "⏳"} {label}</span><span>{myDriver.docs[k] ? "Validé" : "À régulariser — courses limitées"}</span></div>
        ))}
        <div className="sg-note">Sans permis ou assurance à jour, l'algorithme ne vous propose <b>aucune</b> course (sécurité &amp; conformité ARTI).</div>
      </div>
    </main>
  );
}

function AdminView({ drivers, setDrivers, settings, setSettings, history, ride, sosAlerts, onToast }) {
  const enLigne = drivers.filter((d) => d.enLigne).length;
  const gainsJourTotal = drivers.reduce((s, d) => s + d.gainsJour, 0);
  const caEstime = Math.round(gainsJourTotal / (1 - settings.commissionEcoPct / 100));
  const commissionJour = caEstime - gainsJourTotal;
  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: parseFloat(e.target.value) }));
  const hours = [2, 5, 14, 22, 18, 12, 16, 24, 20, 11, 7, 4];
  const hourLabels = ["5h", "7h", "9h", "11h", "13h", "15h", "17h", "19h", "21h", "23h", "1h", "3h"];
  return (
    <main className="sg-single">
      <div className="sg-kpis sg-kpis-admin">
        <div><b>{enLigne}/{drivers.length}</b><span>Chauffeurs en ligne</span></div>
        <div><b>{history.length}</b><span>Courses (cette démo)</span></div>
        <div><b>{formatFCFA(caEstime)}</b><span>CA courses du jour (démo)</span></div>
        <div><b>{formatFCFA(commissionJour)}</b><span>Revenu plateforme du jour</span></div>
        <div><b>{ride ? ride.id : "—"}</b><span>Course en direct</span></div>
        <div><b>{sosAlerts.length}</b><span>Alertes SOS</span></div>
      </div>

      {sosAlerts.length > 0 && <div className="sg-card sg-sos-admin"><b>🆘 Alertes SOS</b>{sosAlerts.map((a) => <div key={a.id}>🚨 {a.at} — course {a.rideId} — {a.lieu} → appeler le client, puis commissariat si besoin.</div>)}</div>}

      <div className="sg-card">
        <b className="sg-big">🎚️ Tarifs &amp; commissions — effet immédiat côté Client</b>
        <label>Commission Éco/Partagé/Piste : <b>{settings.commissionEcoPct}%</b><input type="range" min="5" max="25" value={settings.commissionEcoPct} onChange={set("commissionEcoPct")} /></label>
        <label>Commission Confort/Royal : <b>{settings.commissionConfortPct}%</b><input type="range" min="5" max="25" value={settings.commissionConfortPct} onChange={set("commissionConfortPct")} /></label>
        <label>Commission Livraison : <b>{settings.commissionLivraisonPct}%</b><input type="range" min="5" max="25" value={settings.commissionLivraisonPct} onChange={set("commissionLivraisonPct")} /></label>
        <label>Plafond heure de pointe : <b>x{settings.plafondPointe}</b><input type="range" min="1" max="2" step="0.05" value={settings.plafondPointe} onChange={set("plafondPointe")} /></label>
        <div className="sg-row">
          <label className="sg-grow">Bonus course courte (FCFA)<input className="sg-input" type="number" value={settings.bonusCourseCourte} onChange={set("bonusCourseCourte")} /></label>
          <label className="sg-grow">Frais annulation tardive (FCFA)<input className="sg-input" type="number" value={settings.fraisAnnulation} onChange={set("fraisAnnulation")} /></label>
          <label className="sg-grow">Attente (FCFA/min après {settings.attenteGratuiteMin} min)<input className="sg-input" type="number" value={settings.attenteParMin} onChange={set("attenteParMin")} /></label>
        </div>
        <button className="sg-btn sg-btn-ghost" onClick={() => { setSettings(DEFAULT_SETTINGS); onToast("↩️ Réglages SanwiGo par défaut restaurés."); }}>↩️ Restaurer les réglages recommandés Aboisso</button>
        <div className="sg-note">🎁 Promos actives : {Object.values(PROMOS).map((p) => `${p.code} (${p.desc})`).join(" · ")}</div>
      </div>

      <div className="sg-card">
        <b className="sg-big">🚖 Chauffeurs partenaires &amp; documents</b>
        <div className="sg-table">
          {drivers.map((d) => {
            const manquants = Object.entries(d.docs).filter(([, v]) => !v).map(([k]) => k);
            return (
              <div className="sg-hist sg-driver-row" key={d.id}>
                <span>{d.enLigne ? "🟢" : "⚪"} <b>{d.nom}</b> · {d.plaque} · ⭐{d.note}<br /><small>{d.classes.join(", ")} · {formatFCFA(d.gainsJour)} aujourd'hui · {manquants.length ? `⚠️ Manque : ${manquants.join(", ")}` : "✅ Dossier complet"}</small></span>
                <span className="sg-row">
                  {manquants.map((k) => <button key={k} className="sg-btn sg-btn-ghost" onClick={() => { setDrivers((ds) => ds.map((x) => (x.id === d.id ? { ...x, docs: { ...x.docs, [k]: true } } : x))); onToast(`✅ ${k} validé pour ${d.nom}`); }}>Valider {k}</button>)}
                  <button className="sg-btn sg-btn-ghost" onClick={() => setDrivers((ds) => ds.map((x) => (x.id === d.id ? { ...x, enLigne: !x.enLigne } : x)))}>{d.enLigne ? "Suspendre" : "Réactiver"}</button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sg-card">
        <b className="sg-big">📊 Demande par heure à Aboisso (démo — à brancher sur vos vraies données)</b>
        <div className="sg-bars">{hours.map((v, i) => <div key={i} className="sg-bar-wrap"><div className="sg-bar" style={{ height: `${v * 4}px` }} title={`${v} courses`} /><small>{hourLabels[i]}</small></div>)}</div>
        <div className="sg-note">Pics : 7h-9h (école/bureau), 11h-13h (marché/CHR), 17h-19h30 (retours) + arrivées de cars à la gare. Planifiez les bonus chauffeurs sur ces créneaux plutôt que des « surge » clients élevés.</div>
      </div>

      <div className="sg-card">
        <b className="sg-big">⚖️ Conformité avant lancement réel (check-list)</b>
        <ul className="sg-checklist">
          <li>☐ Autorisation d'exploiter un service VTC — ARTI / Ministère des Transports (décret n°2021-860 du 15/12/2021). Sans elle, activité illégale même avec une belle app.</li>
          <li>☐ Immatriculation entreprise (RCCM Abidjan/Grand-Bassam), NCC, patente — mairie d'Aboisso informée.</li>
          <li>☐ Assurance responsabilité civile professionnelle + vérification assurance/visite technique de chaque véhicule.</li>
          <li>☐ Contrats chauffeurs partenaires écrits (commission, paiement quotidien, charte qualité/sécurité).</li>
          <li>☐ Comptes marchands Wave / Orange Money / MTN MoMo + réconciliation comptable quotidienne.</li>
          <li>☐ Protection des données (ARTCI) : politique de confidentialité, GPS avec consentement, conservation limitée.</li>
          <li>☐ Marque « SanwiGo » déposée à l'OAPI — ne jamais utiliser le nom/logo Yango ni ses visuels.</li>
          <li>☐ Backend production : comptes réels, GPS temps réel, cartes (OSM), notifications, anti-fraude (voir feuille de route SANWIGO.md).</li>
        </ul>
      </div>
    </main>
  );
}
