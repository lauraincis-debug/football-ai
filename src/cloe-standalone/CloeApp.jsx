import { useState, useEffect, useMemo } from "react";
import { createCloeFootballBrain } from "../services/cloeBridge.js";
import { generateThreeDailyTickets } from "../engine/ticketGenerator.js";
import { rebuildModelState } from "../engine/predictor.js";

const CLOE_MEM_KEY = "cloe_ultra_personal_memory_v4";

function loadCloeMemory() {
  try {
    const raw = localStorage.getItem(CLOE_MEM_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {
    userName: "Boss",
    iqScore: 128,
    notes: [
      { id: 1, text: "Vérifier le Ticket Sécurité IA avant les matchs de 20h45", done: false },
      { id: 2, text: "Valider le Capitaine ×2 Fantasy sous 100 M€", done: false },
    ],
    lessons: [
      "Toujours privilégier la sécurité Double Chance / +1.5 Buts quand l'écart Elo est inférieur à 55 pts.",
      "Adapter les montants en FCFA et appliquer le Critère de Kelly ¼ pour protéger le capital.",
    ],
    llmProvider: "gemini", // gemini | groq | openai
    llmApiKey: "",
    favoriteClubs: ["PSG", "Real Madrid", "Arsenal", "Côte d'Ivoire"],
  };
}

export default function CloeApp() {
  const [mem, setMem] = useState(loadCloeMemory);
  const [section, setSection] = useState("assistant"); // assistant | briefing | memory | settings
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [newNote, setNewNote] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const [correctingIdx, setCorrectingIdx] = useState(null);
  const [dailyBriefing, setDailyBriefing] = useState(null);

  const [messages, setMessages] = useState([
    {
      role: "cloe",
      text: "Bonjour ! Je suis Cloé IA Ultra, reliée en temps réel à ton moteur Football AI Ultra v4 (https://football-ai-43e33.web.app).\n\nTu peux me parler au micro 🎤, lancer ton ☀️ Briefing Vocal Matinal, me demander n'importe quel pronostic, ton Ticket Sécurité du jour, ton 11 Fantasy 100M€, une conversion FCFA/€, ou me demander de retenir une note personnelle !",
      rated: null,
    },
  ]);

  const footBrain = useMemo(() => createCloeFootballBrain(), []);

  const updateMem = (patch) => {
    setMem((prev) => {
      const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      try {
        localStorage.setItem(CLOE_MEM_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    footBrain
      .getDailyBriefing()
      .then((b) => setDailyBriefing(b))
      .catch(() => {});
  }, [footBrain]);

  const speak = (text) => {
    if (!voiceOn || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = "fr-FR";
      utt.rate = 1.03;
      const voices = window.speechSynthesis.getVoices?.() || [];
      const frFemale = voices.find(
        (v) => v.lang.startsWith("fr") && /amelie|hortense|julie|thomas|google/i.test(v.name)
      );
      if (frFemale) utt.voice = frFemale;
      utt.onstart = () => setSpeaking(true);
      utt.onend = () => setSpeaking(false);
      utt.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utt);
    } catch {
      setSpeaking(false);
    }
  };

  async function callOptionalCloudLlm(userPrompt, groundedContext) {
    if (!mem.llmApiKey?.trim()) return null;
    const key = mem.llmApiKey.trim();
    const sysPrompt =
      `Tu es Cloé, l'assistante IA personnelle brillante, chaleureuse et auto-évolutive de ${mem.userName}. ` +
      `Tu réponds toujours en français clair, structuré et précis. ` +
      `Règles apprises par Cloé : ${mem.lessons.join(" | ")}. ` +
      `Notes actives de l'utilisateur : ${mem.notes.filter((n) => !n.done).map((n) => n.text).join(" ; ")}. ` +
      `Données exactes calculées en temps réel par Football AI Ultra v4 : ${groundedContext}`;

    try {
      if (mem.llmProvider === "gemini") {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${sysPrompt}\n\nQuestion : ${userPrompt}` }] }],
            }),
          }
        );
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }

      const endpoint =
        mem.llmProvider === "groq"
          ? "https://api.groq.com/openai/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
      const modelName = mem.llmProvider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || null;
    } catch {
      return null;
    }
  }

  async function handleAskCloe(rawQuestion) {
    const q = (rawQuestion ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setLoading(true);

    try {
      const lower = q.toLowerCase();

      // 1. Prise de note / Rappel personnel automatique
      if (lower.startsWith("note ") || lower.includes("rappelle-moi") || lower.includes("retiens que")) {
        const cleaned = q
          .replace(/^(cloé\s*,?\s*)?(note que|note|rappelle-moi de|rappelle-moi|retiens que)\s*/i, "")
          .trim();
        updateMem((prev) => ({
          ...prev,
          iqScore: prev.iqScore + 1,
          notes: [{ id: Date.now(), text: cleaned || q, done: false }, ...prev.notes],
        }));
        const txt = `✅ C'est noté dans ma mémoire longue durée : « ${cleaned || q} ». Mon QI adaptatif passe à ${mem.iqScore + 1} !`;
        setMessages((prev) => [...prev, { role: "cloe", text: txt, rated: null }]);
        speak(`C'est bien enregistré dans ma mémoire : ${cleaned || q}`);
        setLoading(false);
        return;
      }

      // 2. Convertisseur rapide FCFA <-> Euros
      const fcfaMatch = lower.match(/([\d\s.,]+)\s*(fcfa|cfa|eur|euro|€)/i);
      if (fcfaMatch && (lower.includes("convert") || lower.includes("en euro") || lower.includes("en fcfa"))) {
        const num = parseFloat(fcfaMatch[1].replace(/\s/g, "").replace(",", "."));
        if (Number.isFinite(num)) {
          const isEur = /eur|€/i.test(fcfaMatch[2]);
          const resTxt = isEur
            ? `💱 Conversion exacte : **${num.toLocaleString("fr-FR")} €** = **${Math.round(num * 655.957).toLocaleString("fr-FR")} FCFA**`
            : `💱 Conversion exacte : **${Math.round(num).toLocaleString("fr-FR")} FCFA** = **${(num / 655.957).toFixed(2)} €**`;
          setMessages((prev) => [...prev, { role: "cloe", text: resTxt.replace(/\*\*/g, ""), rated: null }]);
          speak(resTxt.replace(/\*\*/g, ""));
          setLoading(false);
          return;
        }
      }

      // 3. Génération Ticket Sécurité / Value / Cote 10+
      if (lower.includes("ticket") || lower.includes("combin")) {
        const briefing = await footBrain.getDailyBriefing();
        setDailyBriefing(briefing);
        const tickets = generateThreeDailyTickets(
          [...briefing.todayMatches, ...briefing.tomorrowMatches],
          rebuildModelState([])
        );
        const safe = tickets[0];
        const value = tickets[1];
        const txt =
          `🎰 Voici mes 2 meilleurs Tickets IA calibrés aujourd'hui :\n\n` +
          `1) ${safe.badge} (@${safe.totalOdd.toFixed(2)} • Fiabilité ${safe.winProbPct}%)\n` +
          safe.items.map((i) => `   • ${i.home} vs ${i.away} → ${i.selectedMarket.label} (${i.selectedMarket.pct}%)`).join("\n") +
          `\n\n2) ${value.badge} (@${value.totalOdd.toFixed(2)} • Fiabilité ${value.winProbPct}%)\n` +
          value.items.map((i) => `   • ${i.home} vs ${i.away} → ${i.selectedMarket.label} (${i.selectedMarket.pct}%)`).join("\n");
        setMessages((prev) => [...prev, { role: "cloe", text: txt, rated: null }]);
        speak(
          `J'ai préparé ton ticket sécurité à une cote totale de ${safe.totalOdd.toFixed(2)} avec ${safe.winProbPct} pour cent de réussite estimée.`
        );
        setLoading(false);
        return;
      }

      // 4. Interrogation directe du cerveau Football AI Ultra v4 + enrichissement LLM optionnel
      const footReply = await footBrain.ask(q);
      const llmEnhanced = await callOptionalCloudLlm(q, footReply.answerText);
      const finalText = llmEnhanced || footReply.answerText;

      setMessages((prev) => [...prev, { role: "cloe", text: finalText, rated: null }]);
      speak(llmEnhanced ? finalText.slice(0, 260) : footReply.voiceText);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "cloe", text: `Je rencontre un léger souci temporaire : ${err.message}`, rated: null },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function runMorningBriefing() {
    setLoading(true);
    try {
      const b = await footBrain.getDailyBriefing({ forceRefresh: true });
      setDailyBriefing(b);
      const activeNotes = mem.notes.filter((n) => !n.done);
      const topGem = b.topGems?.[0];
      const cap = b.fantasyBestXI?.captain;

      const text =
        `☀️ BRIEFING COMPLET DE CLOÉ (${new Date().toLocaleDateString("fr-FR")})\n` +
        `──────────────────────────────\n` +
        `📡 Matchs analysés : ${b.todayCount} aujourd'hui • ${b.tomorrowCount} demain (${b.newlyLearnedMatches} résultat(s) appris)\n` +
        (topGem
          ? `🔥 Pépite n°1 : ${topGem.home} vs ${topGem.away} → ${topGem.safestMarket.label} (${topGem.safestMarket.pct}%)\n`
          : `🔥 Cerveau calibré sur ${b.modelEvolution.memorizedCount} matchs (Marchés validés : ${b.modelEvolution.marketAccuracy}%)\n`) +
        (cap ? `👑 Capitaine Fantasy ×2 : ${cap.name} (${cap.club})\n` : "") +
        `📝 Objectifs personnels actifs : ${activeNotes.length} (${activeNotes.map((n) => n.text).join(" • ") || "Aucun en attente"})`;

      setSection("assistant");
      setMessages((prev) => [...prev, { role: "cloe", text, rated: null }]);
      speak(
        `Bonjour ${mem.userName} ! Voici ton briefing du jour. J'ai analysé ${b.todayCount} matchs aujourd'hui et ${b.tomorrowCount} demain. ` +
          (topGem
            ? `Ma pépite la plus fiable est ${topGem.home} contre ${topGem.away}, option ${topGem.safestMarket.label} à ${topGem.safestMarket.pct} pour cent. `
            : "") +
          (cap ? `En Fantasy, je te recommande ${cap.name} comme capitaine. ` : "") +
          `Tu as aussi ${activeNotes.length} objectif actif dans ton carnet.`
      );
    } finally {
      setLoading(false);
    }
  }

  function startMic() {
    const SR =
      typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;
    const rec = new SR();
    rec.lang = "fr-FR";
    setListening(true);
    rec.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript || "";
      setListening(false);
      if (t.trim()) handleAskCloe(t.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #1b1044 0%, #090820 50%, #050511 100%)",
        color: "#f8fafc",
        paddingBottom: 40,
      }}
    >
      {/* BARRE SUPÉRIEURE CLOÉ */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          backdropFilter: "blur(16px)",
          background: "rgba(9, 8, 32, 0.85)",
          borderBottom: "1px solid rgba(192, 132, 252, 0.25)",
          padding: "14px 16px",
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Orbe Neuronal Vivant de Cloé */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "conic-gradient(from 45deg, #c084fc, #38bdf8, #f472b6, #c084fc)",
                  boxShadow: speaking
                    ? "0 0 28px #c084fc, 0 0 50px #38bdf8"
                    : "0 0 16px rgba(192,132,252,0.55)",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 900,
                  fontSize: 20,
                  transition: "box-shadow 0.3s ease",
                }}
              >
                ✨
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 19, fontWeight: 900, letterSpacing: 0.4 }}>
                    CLOÉ IA ULTRA
                  </span>
                  <span
                    style={{
                      background: "rgba(192,132,252,0.2)",
                      border: "1px solid #c084fc",
                      color: "#e9d5ff",
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    QI ADAPTATIF {mem.iqScore}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
                  Reliée en direct à Football AI Ultra v4 • Voix &amp; Mémoire Auto-Évolutive
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={runMorningBriefing}
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #ec4899)",
                  border: "none",
                  borderRadius: 999,
                  padding: "7px 13px",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ☀️ Briefing Vocal
              </button>
              <button
                type="button"
                onClick={() => setVoiceOn((v) => !v)}
                style={{
                  background: voiceOn ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.08)",
                  border: `1px solid ${voiceOn ? "#10b981" : "#475569"}`,
                  borderRadius: 999,
                  padding: "7px 12px",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {voiceOn ? "🔊 Voix ON" : "🔇 Muet"}
              </button>
              <a
                href="https://football-ai-43e33.web.app"
                style={{
                  background: "rgba(56,189,248,0.16)",
                  border: "1px solid rgba(56,189,248,0.5)",
                  borderRadius: 999,
                  padding: "7px 12px",
                  color: "#7dd3fc",
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                ⚡ Ouvrir Football AI
              </a>
            </div>
          </div>

          {/* Navigation interne Cloé */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, overflowX: "auto" }}>
            {[
              ["assistant", "💬 Parler à Cloé"],
              ["memory", `🧠 Mémoire & Objectifs (${mem.notes.filter((n) => !n.done).length})`],
              ["settings", "⚙️ Cerveau & Clé LLM"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                style={{
                  background:
                    section === id
                      ? "linear-gradient(135deg, #8b5cf6, #06b6d4)"
                      : "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 999,
                  padding: "7px 14px",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "18px auto 0", padding: "0 14px" }}>
        {section === "assistant" && (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Suggestions rapides */}
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {[
                "Quelles sont les pépites d'aujourd'hui et demain ?",
                "Prépare mon Ticket Sécurité IA du jour",
                "Analyse Real Madrid contre Barcelone",
                "Quel capitaine Fantasy 100M€ choisir ?",
                "Convertis 50000 FCFA en euros",
                "Qu'as-tu appris de tes erreurs ?",
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleAskCloe(q)}
                  style={{
                    background: "rgba(139,92,246,0.16)",
                    border: "1px solid rgba(192,132,252,0.35)",
                    color: "#e9d5ff",
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ✨ {q}
                </button>
              ))}
            </div>

            {/* Fil de conversation avec auto-apprentissage 👍 / 👎 */}
            <div
              style={{
                background: "rgba(10, 12, 34, 0.78)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 18,
                padding: 16,
                minHeight: 340,
                maxHeight: "56vh",
                overflowY: "auto",
                display: "grid",
                gap: 12,
              }}
            >
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    justifySelf: m.role === "user" ? "end" : "start",
                    maxWidth: "88%",
                    background:
                      m.role === "user"
                        ? "linear-gradient(135deg, #6d28d9, #0284c7)"
                        : "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 14,
                    padding: "11px 14px",
                    whiteSpace: "pre-line",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  {m.role === "cloe" && (
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: "#c084fc", marginBottom: 4 }}>
                      ✨ CLOÉ IA ULTRA
                    </div>
                  )}
                  <div>{m.text}</div>

                  {/* Auto-Critique & Apprentissage de Cloé */}
                  {m.role === "cloe" && idx > 0 && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 11 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setMessages((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, rated: "up" } : x))
                          );
                          updateMem((prev) => ({ ...prev, iqScore: prev.iqScore + 2 }));
                        }}
                        style={{
                          background: m.rated === "up" ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          color: "#fff",
                          borderRadius: 8,
                          padding: "3px 8px",
                          cursor: "pointer",
                        }}
                      >
                        👍 Pertinent (+2 QI)
                      </button>
                      <button
                        type="button"
                        onClick={() => setCorrectingIdx(correctingIdx === idx ? null : idx)}
                        style={{
                          background: "rgba(244,63,94,0.18)",
                          border: "1px solid rgba(244,63,94,0.35)",
                          color: "#fda4af",
                          borderRadius: 8,
                          padding: "3px 8px",
                          cursor: "pointer",
                        }}
                      >
                        🧠 Enseigner une correction à Cloé
                      </button>
                    </div>
                  )}

                  {correctingIdx === idx && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <input
                        type="text"
                        value={correctionText}
                        onChange={(e) => setCorrectionText(e.target.value)}
                        placeholder="Ex: Privilégie toujours la Double Chance sur les derbys..."
                        style={{
                          flex: 1,
                          background: "#090b1f",
                          border: "1px solid #475569",
                          borderRadius: 8,
                          padding: "6px 8px",
                          color: "#fff",
                          fontSize: 12,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!correctionText.trim()) return;
                          updateMem((prev) => ({
                            ...prev,
                            iqScore: prev.iqScore + 5,
                            lessons: [correctionText.trim(), ...prev.lessons],
                          }));
                          setCorrectionText("");
                          setCorrectingIdx(null);
                          speak("Merci ! J'ai gravé cette nouvelle règle dans ma mémoire permanente.");
                        }}
                        style={{
                          background: "#10b981",
                          border: "none",
                          borderRadius: 8,
                          padding: "6px 10px",
                          color: "#fff",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        Mémoriser (+5 QI)
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div style={{ color: "#38bdf8", fontSize: 12.5 }}>
                  ✨ Cloé réfléchit et interroge Football AI Ultra v4 en temps réel...
                </div>
              )}
            </div>

            {/* Barre de saisie vocale & texte */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAskCloe();
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <button
                type="button"
                onClick={startMic}
                style={{
                  background: listening
                    ? "linear-gradient(135deg, #ef4444, #f97316)"
                    : "rgba(192,132,252,0.22)",
                  border: "1px solid #c084fc",
                  borderRadius: 12,
                  padding: "12px 14px",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {listening ? "🎙️ Écoute..." : "🎤"}
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Parle ou écris à Cloé (pronostic, ticket du jour, note personnelle...)"
                style={{
                  flex: 1,
                  background: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(192,132,252,0.4)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  color: "#fff",
                  fontSize: 14,
                }}
              />
              <button
                type="submit"
                style={{
                  background: "linear-gradient(135deg, #8b5cf6, #06b6d4)",
                  border: "none",
                  borderRadius: 12,
                  padding: "12px 18px",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Envoyer
              </button>
            </form>
          </div>
        )}

        {section === "memory" && (
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 16,
                padding: 16,
              }}
            >
              <h3 style={{ margin: "0 0 10px" }}>📝 Objectifs &amp; Notes Personnelles de {mem.userName}</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newNote.trim()) return;
                  updateMem((prev) => ({
                    ...prev,
                    notes: [{ id: Date.now(), text: newNote.trim(), done: false }, ...prev.notes],
                  }));
                  setNewNote("");
                }}
                style={{ display: "flex", gap: 8, marginBottom: 12 }}
              >
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Ajouter un objectif ou mémo personnel..."
                  style={{
                    flex: 1,
                    background: "#090b1f",
                    border: "1px solid #475569",
                    borderRadius: 10,
                    padding: "9px 12px",
                    color: "#fff",
                  }}
                />
                <button
                  type="submit"
                  style={{
                    background: "#8b5cf6",
                    border: "none",
                    borderRadius: 10,
                    padding: "9px 14px",
                    color: "#fff",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  + Ajouter
                </button>
              </form>

              <div style={{ display: "grid", gap: 8 }}>
                {mem.notes.map((n) => (
                  <div
                    key={n.id}
                    onClick={() =>
                      updateMem((prev) => ({
                        ...prev,
                        notes: prev.notes.map((x) => (x.id === n.id ? { ...x, done: !x.done } : x)),
                      }))
                    }
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      padding: "10px 12px",
                      borderRadius: 10,
                      cursor: "pointer",
                      textDecoration: n.done ? "line-through" : "none",
                      opacity: n.done ? 0.55 : 1,
                    }}
                  >
                    {n.done ? "✅ " : "⬜ "}
                    {n.text}
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 16,
                padding: 16,
              }}
            >
              <h3 style={{ margin: "0 0 8px" }}>🧬 Règles Cognitives Apprises par Cloé ({mem.lessons.length})</h3>
              <div style={{ display: "grid", gap: 6, fontSize: 13, color: "#cbd5e1" }}>
                {mem.lessons.map((l, i) => (
                  <div key={i} style={{ background: "rgba(139,92,246,0.14)", padding: "8px 12px", borderRadius: 10 }}>
                    🧠 Règle #{i + 1} : {l}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === "settings" && (
          <div
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 16,
              padding: 16,
              display: "grid",
              gap: 12,
            }}
          >
            <h3 style={{ margin: 0 }}>⚙️ Paramètres Cognitifs &amp; Grand Modèle LLM Optionnel</h3>
            <div>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>Comment Cloé doit-elle t&apos;appeler ?</label>
              <input
                type="text"
                value={mem.userName}
                onChange={(e) => updateMem({ userName: e.target.value })}
                style={{
                  width: "100%",
                  marginTop: 4,
                  background: "#090b1f",
                  border: "1px solid #475569",
                  borderRadius: 10,
                  padding: "9px 12px",
                  color: "#fff",
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>
                Fournisseur IA Conversationnelle (optionnel — sans clé, Cloé fonctionne déjà à 100 % en autonomie !)
              </label>
              <select
                value={mem.llmProvider}
                onChange={(e) => updateMem({ llmProvider: e.target.value })}
                style={{
                  width: "100%",
                  marginTop: 4,
                  background: "#090b1f",
                  border: "1px solid #475569",
                  borderRadius: 10,
                  padding: "9px 12px",
                  color: "#fff",
                }}
              >
                <option value="gemini">Google Gemini 2.0 Flash (Clé AI Studio gratuite)</option>
                <option value="groq">Groq Llama 3.3 70B Ultra-Rapide (Clé Groq gratuite)</option>
                <option value="openai">OpenAI GPT-4o-mini</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>Clé API IA (stockée uniquement sur ton appareil)</label>
              <input
                type="password"
                value={mem.llmApiKey}
                onChange={(e) => updateMem({ llmApiKey: e.target.value })}
                placeholder="Coller une clé AIza... / gsk_... / sk-..."
                style={{
                  width: "100%",
                  marginTop: 4,
                  background: "#090b1f",
                  border: "1px solid #475569",
                  borderRadius: 10,
                  padding: "9px 12px",
                  color: "#fff",
                }}
              />
            </div>

            {dailyBriefing && (
              <div style={{ fontSize: 12, color: "#6ee7b7" }}>
                ✓ Synchronisation active avec Football AI Ultra v4 ({dailyBriefing.modelEvolution.memorizedCount} matchs calibrés).
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
