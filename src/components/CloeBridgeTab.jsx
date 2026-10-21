import React, { useState, useMemo } from "react";
import { createCloeFootballBrain } from "../services/cloeBridge.js";

const QUICK_PROMPTS = [
  "Quels sont les pronostics et pépites d'aujourd'hui et demain ?",
  "Analyse PSG contre Real Madrid",
  "Donne-moi la meilleure équipe Fantasy et le capitaine",
  "Qu'as-tu appris de tes dernières erreurs ?",
];

export default function CloeBridgeTab({
  predictions,
  optaOverrides,
  evolvedHyper,
  learnedExternalIds,
  liveFixturesSnapshot,
  showToast,
}) {
  const [messages, setMessages] = useState([
    {
      role: "cloe",
      text: "Bonjour ! Je suis connectée au cerveau hybride Football AI Ultra v3. Pose-moi une question sur les matchs d'aujourd'hui, demain, un duel, ton 11 Fantasy ou mes leçons apprises — ou copie le connecteur ci-dessous dans l'application Cloé sur Firebase !",
      confidence: 96,
    },
  ]);
  const [input, setInput] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState("");

  function startMicQuestion() {
    const SpeechRec =
      typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRec) {
      if (showToast) showToast("Micro vocal non supporté par ce navigateur.");
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = "fr-FR";
      rec.interimResults = false;
      setListening(true);
      rec.onresult = (ev) => {
        const transcript = ev.results?.[0]?.[0]?.transcript || "";
        setListening(false);
        if (transcript.trim()) handleAsk(transcript.trim());
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      rec.start();
    } catch {
      setListening(false);
    }
  }

  const brain = useMemo(() => {
    const b = createCloeFootballBrain();
    b.syncLocalState({ predictions, optaOverrides, evolvedHyper, learnedExternalIds });
    return b;
  }, [predictions, optaOverrides, evolvedHyper, learnedExternalIds]);

  const summary = brain.getStateSummary();

  function speakText(txt) {
    if (!voiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(txt);
      utt.lang = "fr-FR";
      utt.rate = 1.03;
      window.speechSynthesis.speak(utt);
    } catch {
      // ignore
    }
  }

  async function handleAsk(questionText) {
    const q = (questionText ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setLoading(true);
    try {
      const reply = await brain.ask(q, { externalFixtures: liveFixturesSnapshot });
      setMessages((prev) => [
        ...prev,
        {
          role: "cloe",
          text: reply.answerText,
          confidence: reply.confidence,
          intent: reply.intent,
        },
      ]);
      if (reply.voiceText) speakText(reply.voiceText);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "cloe", text: `Erreur temporaire : ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function copyCode(id, code) {
    navigator.clipboard?.writeText(code);
    setCopiedId(id);
    if (showToast) showToast("Code de connexion Cloé copié !", "success");
    setTimeout(() => setCopiedId(""), 2500);
  }

  const scriptSnippet = `<!-- 1. À coller dans le index.html de Cloé (ex: jarvis-1v2.web.app) -->
<script src="https://football-ai-43e33.web.app/cloe-bridge.js"></script>

<script>
  // 2. Dans le code de réponse de Cloé :
  async function demanderFootballIA(questionUtilisateur) {
    const reponse = await window.CloeFootballAI.ask(questionUtilisateur);
    console.log("Données complètes :", reponse.data);
    return reponse.answerText; // ou reponse.voiceText pour la voix de Cloé !
  }
</script>`;

  const apiDirectSnippet = `// Lire directement tous les matchs du jour, demain, Fantasy 100M€ & évolution :
const briefing = await window.CloeFootballAI.getDailyBriefing();
// briefing.todayMatches   -> tous les matchs d'aujourd'hui analysés
// briefing.tomorrowMatches -> tous les matchs de demain analysés
// briefing.topGems        -> les 5 pronostics les plus sûrs
// briefing.fantasyBestXI  -> le 11 optimal sous 100M€ + Capitaine
// briefing.modelEvolution -> précision, Brier Score & erreurs apprises`;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Bandeau d'état temps réel */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(56,189,248,0.12))",
          border: "1px solid rgba(168,85,247,0.38)",
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#f8fafc" }}>
              🤖 Pont IA Temps Réel : Football AI Ultra v3 ↔ Cloé
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 3 }}>
              SDK public CORS actif sur{" "}
              <code style={{ color: "#38bdf8" }}>https://football-ai-43e33.web.app/cloe-bridge.js</code>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a
              href="https://jarvis-1v2.web.app"
              target="_blank"
              rel="noreferrer"
              style={{
                background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
                color: "#fff",
                textDecoration: "none",
                borderRadius: 999,
                padding: "6px 13px",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              ✨ Ouvrir Cloé IA Ultra (jarvis-1v2) ↗
            </a>
            <button
              type="button"
              onClick={() => setVoiceEnabled((v) => !v)}
              style={{
                background: voiceEnabled ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${voiceEnabled ? "#10b981" : "rgba(255,255,255,0.16)"}`,
                color: voiceEnabled ? "#6ee7b7" : "#94a3b8",
                borderRadius: 999,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {voiceEnabled ? "🔊 Voix Cloé ON" : "🔇 Voix Cloé OFF"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 8,
            marginTop: 12,
          }}
        >
          <div style={{ background: "rgba(9,11,30,0.65)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>GÉNÉRATION IA</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#c084fc" }}>Gén. #{summary.generation}</div>
          </div>
          <div style={{ background: "rgba(9,11,30,0.65)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>MATCHS EN MÉMOIRE</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#38bdf8" }}>{summary.memorizedMatches}</div>
          </div>
          <div style={{ background: "rgba(9,11,30,0.65)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>MARCHÉS VALIDÉS</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#10b981" }}>{summary.marketAccuracy}%</div>
          </div>
          <div style={{ background: "rgba(9,11,30,0.65)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>LEÇONS D'ERREURS</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#fbbf24" }}>{summary.lessonsCount}</div>
          </div>
        </div>
      </div>

      {/* Console de test en direct de Cloé */}
      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: "#cbd5e1", marginBottom: 10 }}>
          💬 Tester en direct ce que Cloé répond (avec sa voix)
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => handleAsk(q)}
              style={{
                background: "rgba(99,102,241,0.16)",
                border: "1px solid rgba(99,102,241,0.35)",
                color: "#c7d2fe",
                borderRadius: 999,
                padding: "6px 11px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ⚡ {q}
            </button>
          ))}
        </div>

        <div
          style={{
            maxHeight: 290,
            overflowY: "auto",
            display: "grid",
            gap: 8,
            padding: 10,
            borderRadius: 12,
            background: "rgba(6,8,22,0.7)",
            border: "1px solid rgba(255,255,255,0.06)",
            marginBottom: 10,
          }}
        >
          {messages.map((m, idx) => (
            <div
              key={idx}
              style={{
                justifySelf: m.role === "user" ? "end" : "start",
                maxWidth: "90%",
                background:
                  m.role === "user"
                    ? "linear-gradient(135deg, #4f46e5, #7c3aed)"
                    : "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding: "10px 12px",
                fontSize: 12.5,
                lineHeight: 1.5,
                whiteSpace: "pre-line",
                color: "#f1f5f9",
              }}
            >
              {m.role === "cloe" && (
                <div style={{ fontSize: 10, fontWeight: 800, color: "#c084fc", marginBottom: 4 }}>
                  🤖 CLOÉ × FOOTBALL AI {m.confidence ? `· Confiance ${m.confidence}%` : ""}
                </div>
              )}
              {m.text}
            </div>
          ))}
          {loading && (
            <div style={{ fontSize: 12, color: "#38bdf8" }}>
              🤖 Cloé analyse les matchs en direct et interroge sa mémoire évolutive...
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <button
            type="button"
            onClick={startMicQuestion}
            title="Parler directement à Cloé"
            style={{
              background: listening
                ? "linear-gradient(135deg, #ef4444, #f97316)"
                : "rgba(168,85,247,0.22)",
              border: "1px solid rgba(168,85,247,0.5)",
              borderRadius: 10,
              padding: "10px 13px",
              color: "#fff",
              fontWeight: 800,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {listening ? "🎙️ Écoute..." : "🎤 Micro"}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ex: Qui va gagner Barcelone vs Arsenal ? / Matchs de demain..."
            style={{
              flex: 1,
              background: "rgba(15,23,42,0.85)",
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: 10,
              padding: "10px 12px",
              color: "#fff",
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              background: "linear-gradient(135deg, #8b5cf6, #06b6d4)",
              border: "none",
              borderRadius: 10,
              padding: "10px 16px",
              color: "#fff",
              fontWeight: 800,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Demander
          </button>
        </form>
      </div>

      {/* Snippets prêts à copier dans Cloé (Firebase / Web) */}
      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 900, color: "#f8fafc" }}>
          🔌 Brancher dans le projet Firebase de Cloé en 30 secondes
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#93c5fd" }}>
              1️⃣ Balise directe à coller dans Cloé (`index.html`)
            </span>
            <button
              type="button"
              onClick={() => copyCode("script", scriptSnippet)}
              style={{
                background: "rgba(56,189,248,0.18)",
                border: "1px solid rgba(56,189,248,0.4)",
                color: "#7dd3fc",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {copiedId === "script" ? "✅ Copié !" : "📋 Copier"}
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 10,
              background: "#060816",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#e2e8f0",
              fontSize: 11,
              overflowX: "auto",
            }}
          >
            {scriptSnippet}
          </pre>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#6ee7b7" }}>
              2️⃣ Lire en JSON tous les matchs Live, Fantasy 100M€ & Mémoire IA
            </span>
            <button
              type="button"
              onClick={() => copyCode("api", apiDirectSnippet)}
              style={{
                background: "rgba(16,185,129,0.18)",
                border: "1px solid rgba(16,185,129,0.4)",
                color: "#6ee7b7",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {copiedId === "api" ? "✅ Copié !" : "📋 Copier"}
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 10,
              background: "#060816",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#e2e8f0",
              fontSize: 11,
              overflowX: "auto",
            }}
          >
            {apiDirectSnippet}
          </pre>
        </div>
      </div>
    </div>
  );
}
