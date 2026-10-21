import { useState, useRef } from "react";
import { analyzeMatchVideoFile, buildSyntheticVideoDemo } from "../engine/videoAnalyzer.js";

export default function VideoAnalysisTab({
  activeHome,
  activeAway,
  videoInsight,
  onVideoInsightReady,
  onClearVideoInsight,
  onApplyAndGoPredict,
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const videoPlayerRef = useRef(null);
  const uploadInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzing(true);
    setProgress(5);
    setErrorMsg("");

    try {
      const result = await analyzeMatchVideoFile(file, (pct) => setProgress(pct));
      onVideoInsightReady(result);
    } catch (err) {
      setErrorMsg(err.message || "Erreur lors de l'analyse vidéo.");
    }
    setAnalyzing(false);
    e.target.value = "";
  };

  const handleLoadSyntheticDemo = () => {
    setErrorMsg("");
    const demo = buildSyntheticVideoDemo(activeHome || "PSG", activeAway || "Marseille");
    onVideoInsightReady(demo);
  };

  const jumpToSecond = (sec) => {
    if (videoPlayerRef.current) {
      videoPlayerRef.current.currentTime = sec;
      videoPlayerRef.current.play().catch(() => {});
    }
  };

  return (
    <div>
      <div className="fai-panel">
        <div className="fai-section-title">
          <span>🎥 Laboratoire Vidéo Vision IA — Analyse Tactique &amp; Pressing</span>
          <span style={{ color: "#00e676" }}>
            Cible actuelle : {activeHome} vs {activeAway}
          </span>
        </div>

        <p style={{ fontSize: 13, color: "#9aa3c7", lineHeight: 1.55, marginBottom: 16 }}>
          Téléversez un extrait vidéo de match (<code>.mp4</code>, <code>.webm</code>,{" "}
          <code>.mov</code> depuis votre galerie ou caméra mobile). Le moteur Vision IA découpe la
          séquence sur Canvas, segmente la pelouse, mesure l&apos;intensité du pressing, localise
          les zones de domination et ajuste directement les <strong>Expected Goals (xG)</strong> de
          la prédiction !
        </p>

        {/* Zone Upload Drag / Tap Mobile */}
        <div
          onClick={() => uploadInputRef.current?.click()}
          style={{
            border: "2px dashed rgba(0, 229, 255, 0.45)",
            borderRadius: 16,
            padding: "28px 20px",
            textAlign: "center",
            background: "rgba(8, 10, 28, 0.7)",
            cursor: "pointer",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 34, marginBottom: 8 }}>📹</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>
            Appuyez ici pour importer ou filmer un extrait de match (MP4 / MOV / WebM)
          </div>
          <div style={{ fontSize: 12, color: "#7f89b2", marginTop: 4 }}>
            Traitement local haute vitesse 100 % confidentiel (aucun envoi lourd sur serveur)
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="fai-btn-secondary"
            onClick={handleLoadSyntheticDemo}
          >
            🎬 Tester avec une Séquence Tactique Démo ({activeHome} vs {activeAway})
          </button>

          {videoInsight && (
            <button
              type="button"
              className="fai-btn-ghost"
              style={{ color: "#ff3d5a" }}
              onClick={onClearVideoInsight}
            >
              ✕ Désactiver le modificateur vidéo
            </button>
          )}
        </div>

        {analyzing && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: "#00e5ff", marginBottom: 6 }}>
              🔍 Extraction &amp; segmentation Vision IA des frames ({progress}%)...
            </div>
            <div style={{ height: 8, background: "#141836", borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #00e5ff, #00e676)",
                  transition: "width 0.2s",
                }}
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <div style={{ marginTop: 12, color: "#ff3d5a", fontSize: 12.5 }}>{errorMsg}</div>
        )}
      </div>

      {/* Résultats complets de l'analyse vidéo */}
      {videoInsight && (
        <div className="fai-panel">
          <div className="fai-section-title">
            <span>📊 Rapport Tactique Vision IA — {videoInsight.fileName}</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "#00e5ff" }}>
              {videoInsight.resolution} • {videoInsight.durationSec}s
            </span>
          </div>

          {videoInsight.videoUrl && (
            <div style={{ marginBottom: 18 }}>
              <video
                ref={videoPlayerRef}
                src={videoInsight.videoUrl}
                controls
                playsInline
                style={{
                  width: "100%",
                  maxHeight: 340,
                  borderRadius: 12,
                  background: "#000",
                  border: "1px solid var(--border-muted)",
                }}
              />
            </div>
          )}

          {/* 4 KPIs Vision */}
          <div className="fai-stats-grid">
            <div className="fai-stat-card">
              <div className="fai-kpi-lbl">Intensité Pressing</div>
              <div className="fai-kpi-val" style={{ color: "#00e676", fontSize: 26, marginTop: 4 }}>
                {videoInsight.pressingScore}/100
              </div>
              <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 3 }}>
                Flux optique temporel
              </div>
            </div>

            <div className="fai-stat-card">
              <div className="fai-kpi-lbl">Compacité du Bloc</div>
              <div className="fai-kpi-val" style={{ color: "#00e5ff", fontSize: 26, marginTop: 4 }}>
                {videoInsight.compactnessScore}/100
              </div>
              <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 3 }}>
                Dispersion spatiale joueurs
              </div>
            </div>

            <div className="fai-stat-card">
              <div className="fai-kpi-lbl">Tilt Territorial</div>
              <div className="fai-kpi-val" style={{ color: "#9d7bff", fontSize: 26, marginTop: 4 }}>
                {videoInsight.territorialTiltHome}% / {100 - videoInsight.territorialTiltHome}%
              </div>
              <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 3 }}>
                Pression dans le camp adverse
              </div>
            </div>

            <div className="fai-stat-card">
              <div className="fai-kpi-lbl">Impact xG Calculé</div>
              <div className="fai-kpi-val" style={{ color: "#ffea00", fontSize: 22, marginTop: 4 }}>
                ×{videoInsight.homeXgMult} / ×{videoInsight.awayXgMult}
              </div>
              <div style={{ fontSize: 11, color: "#7f89b2", marginTop: 3 }}>
                Modificateur Dom. / Ext.
              </div>
            </div>
          </div>

          <div className="fai-grid-2">
            {/* Zonage des 3 tiers du terrain */}
            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: "#080a1c",
                border: "1px solid var(--border-muted)",
              }}
            >
              <div className="fai-section-title">
                <span>🟢 Occupation Spatiale des 3 Tiers du Terrain</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                  padding: 12,
                  borderRadius: 10,
                  background: "linear-gradient(90deg, #0d3b26, #135235, #0d3b26)",
                  border: "1px solid rgba(0,230,118,0.4)",
                  textAlign: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: "#b9f6ca" }}>Tiers Défensif</div>
                  <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "var(--font-mono)" }}>
                    {videoInsight.zones.leftPct}%
                  </div>
                </div>
                <div
                  style={{
                    borderLeft: "1px dashed rgba(255,255,255,0.3)",
                    borderRight: "1px dashed rgba(255,255,255,0.3)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#b9f6ca" }}>Milieu / Construction</div>
                  <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "var(--font-mono)" }}>
                    {videoInsight.zones.midPct}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#b9f6ca" }}>Surface Adverse</div>
                  <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "var(--font-mono)" }}>
                    {videoInsight.zones.rightPct}%
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 12.5, color: "#dce1ff" }}>
                <strong>Diagnostic Style :</strong> {videoInsight.tacticalStyle}
              </div>
            </div>

            {/* Courbe des Temps Forts & Contre-attaques */}
            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: "#080a1c",
                border: "1px solid var(--border-muted)",
              }}
            >
              <div className="fai-section-title">
                <span>⚡ Courbe d&apos;Intensité &amp; Pics d&apos;Action Cliquables</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 4,
                  height: 92,
                  padding: "8px 4px",
                }}
              >
                {videoInsight.timeline.map((pt) => (
                  <div
                    key={pt.step}
                    onClick={() => jumpToSecond(pt.timeSec)}
                    title={`${pt.timeLabel} — Intensité ${pt.intensity}/100`}
                    style={{
                      flex: 1,
                      height: `${pt.intensity}%`,
                      borderRadius: "4px 4px 0 0",
                      cursor: "pointer",
                      background:
                        pt.intensity >= 72
                          ? "linear-gradient(180deg, #00e676, #00b0ff)"
                          : "rgba(124, 77, 255, 0.55)",
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {videoInsight.peakMoments.map((pk) => (
                  <button
                    key={pk.step}
                    type="button"
                    className="fai-quick-chip"
                    onClick={() => jumpToSecond(pk.timeSec)}
                  >
                    🔥 Pic à {pk.timeLabel} ({pk.intensity}/100)
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="fai-btn-primary"
            style={{ marginTop: 18 }}
            onClick={onApplyAndGoPredict}
          >
            ⚡ Injecter ces Données Vidéo dans la Prédiction « {activeHome} vs {activeAway} »
          </button>
        </div>
      )}
    </div>
  );
}
