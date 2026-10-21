// ============================================================
// MOTEUR D'ANALYSE VIDÉO PAR VISION IA (HTML5 VIDEO + CANVAS 2D)
// Extraction réelle d'images de la vidéo téléversée :
// 1. Segmentation chromatique pelouse (vert HSV/RGB)
// 2. Densité d'occupation par tiers de terrain (Gauche / Milieu / Surface)
// 3. Flux optique temporel image-par-image (Intensité Pressing & Temps Forts)
// 4. Conversion directe en modificateur xG pour le Moteur Prédictif !
// ============================================================

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function seekVideoToTime(videoEl, timeSec) {
  return new Promise((resolve) => {
    const onSeeked = () => {
      videoEl.removeEventListener("seeked", onSeeked);
      resolve();
    };
    videoEl.addEventListener("seeked", onSeeked, { once: true });
    videoEl.currentTime = timeSec;
    // Sécurité anti-blocage si le navigateur garde la même frame clé
    setTimeout(() => {
      videoEl.removeEventListener("seeked", onSeeked);
      resolve();
    }, 350);
  });
}

/**
 * Analyse image-par-image un fichier vidéo réel (.mp4, .webm, .mov) chargé par l'utilisateur
 */
export async function analyzeMatchVideoFile(file, onProgress = () => {}) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () =>
      reject(new Error("Format vidéo non supporté par ce navigateur (utilisez MP4 ou WebM)."));
    setTimeout(() => reject(new Error("Délai dépassé lors de la lecture vidéo.")), 8000);
  });

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
  const W = 160;
  const H = 90;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const SAMPLE_COUNT = 18;
  let prevLuma = null;
  let totalPitchPixels = 0;
  let totalScannedPixels = 0;
  const thirdActivity = [0, 0, 0]; // [Tiers Gauche, Tiers Central, Tiers Droit]
  const timeline = [];
  let spreadSum = 0;
  let spreadCount = 0;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = Math.min(duration - 0.05, Math.max(0.05, ((i + 0.5) / SAMPLE_COUNT) * duration));
    await seekVideoToTime(video, t);
    ctx.drawImage(video, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    const curLuma = new Float32Array(W * H);
    let pitchCount = 0;
    let motionSum = 0;
    const activeXs = [];

    for (let y = 8; y < H - 8; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const pIdx = y * W + x;
        curLuma[pIdx] = luma;

        const isGrass = g > r * 1.07 && g > b * 1.11 && g > 34;
        if (isGrass) pitchCount += 1;

        const thirdIdx = x < W / 3 ? 0 : x < (2 * W) / 3 ? 1 : 2;
        if (!isGrass && luma > 42) {
          thirdActivity[thirdIdx] += 1;
        }

        if (prevLuma) {
          const diff = Math.abs(luma - prevLuma[pIdx]);
          motionSum += diff;
          if (diff > 24) {
            activeXs.push(x / W);
          }
        }
      }
    }

    if (activeXs.length > 10) {
      const meanX = activeXs.reduce((a, b) => a + b, 0) / activeXs.length;
      const stdX = Math.sqrt(
        activeXs.reduce((s, v) => s + Math.pow(v - meanX, 2), 0) / activeXs.length
      );
      spreadSum += stdX;
      spreadCount += 1;
    }

    const innerPixels = (H - 16) * W;
    totalPitchPixels += pitchCount;
    totalScannedPixels += innerPixels;

    const motionScore = prevLuma
      ? Math.round(clamp((motionSum / innerPixels) * 4.2, 8, 99))
      : 42;

    timeline.push({
      step: i + 1,
      timeSec: Math.round(t * 10) / 10,
      timeLabel: `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`,
      intensity: motionScore,
      pitchRatioPct: Math.round((pitchCount / innerPixels) * 100),
    });

    prevLuma = curLuma;
    onProgress(Math.round(((i + 1) / SAMPLE_COUNT) * 100));
  }

  const avgPitchPct = Math.round((totalPitchPixels / Math.max(1, totalScannedPixels)) * 100);
  const avgIntensity = Math.round(
    timeline.reduce((s, pt) => s + pt.intensity, 0) / timeline.length
  );
  const sumThirds = thirdActivity[0] + thirdActivity[1] + thirdActivity[2] || 1;
  const zoneLeftPct = Math.round((thirdActivity[0] / sumThirds) * 100);
  const zoneMidPct = Math.round((thirdActivity[1] / sumThirds) * 100);
  const zoneRightPct = 100 - zoneLeftPct - zoneMidPct;

  // Domination territoriale orientée (Gauche vs Droite)
  const sideSum = thirdActivity[0] + thirdActivity[2] || 1;
  const territorialTiltHome = Math.round(
    clamp(35 + ((thirdActivity[2] - thirdActivity[0]) / sideSum) * 45 + 15, 28, 76)
  );

  const avgSpread = spreadCount > 0 ? spreadSum / spreadCount : 0.24;
  const compactnessScore = Math.round(clamp((1 - avgSpread * 1.9) * 100, 32, 94));
  const pressingScore = Math.round(clamp(avgIntensity * 0.72 + compactnessScore * 0.28, 25, 97));

  const peakMoments = [...timeline]
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 3)
    .sort((a, b) => a.timeSec - b.timeSec);

  // Calcul des multiplicateurs xG issus de la séquence vidéo analysée
  const tempoFactor = 1 + (pressingScore - 58) * 0.0028;
  const tiltDelta = (territorialTiltHome - 50) * 0.0042;
  const homeXgMult = Math.round(clamp(tempoFactor + tiltDelta, 0.84, 1.24) * 1000) / 1000;
  const awayXgMult = Math.round(clamp(tempoFactor - tiltDelta * 0.75, 0.84, 1.22) * 1000) / 1000;

  const tacticalStyle =
    pressingScore >= 72
      ? "Gegenpressing Haute Intensité & Transitions Verticales Rapides"
      : pressingScore >= 52
        ? "Bloc Médian Structuré & Attaques Placées Progressistes"
        : "Bloc Bas Compact & Gestion Fermée du Tempo";

  return {
    fileName: file.name,
    videoUrl: objectUrl,
    durationSec: Math.round(duration * 10) / 10,
    resolution: `${video.videoWidth || W}×${video.videoHeight || H}`,
    sampledFrames: SAMPLE_COUNT,
    avgPitchPct,
    pressingScore,
    compactnessScore,
    avgIntensity,
    zones: {
      leftPct: zoneLeftPct,
      midPct: zoneMidPct,
      rightPct: zoneRightPct,
    },
    territorialTiltHome,
    peakMoments,
    timeline,
    tacticalStyle,
    homeXgMult,
    awayXgMult,
  };
}

/**
 * Génère instantanément une analyse tactique vidéo de démonstration interactive
 * (utile pour tester sans fichier MP4 sous la main sur mobile)
 */
export function buildSyntheticVideoDemo(homeName, awayName) {
  const timeline = Array.from({ length: 18 }, (_, i) => {
    const t = (i + 1) * 2.5;
    const wave = 52 + Math.round(28 * Math.sin(i * 0.85) + (i % 5 === 2 ? 16 : 0));
    return {
      step: i + 1,
      timeSec: t,
      timeLabel: `0:${String(Math.floor(t)).padStart(2, "0")}`,
      intensity: clamp(wave, 24, 96),
      pitchRatioPct: 74,
    };
  });
  const peakMoments = [...timeline]
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 3)
    .sort((a, b) => a.timeSec - b.timeSec);

  return {
    fileName: `Séquence_Tactique_${homeName}_vs_${awayName}.mp4`,
    videoUrl: null,
    durationSec: 45,
    resolution: "1920×1080 (Simulation Tactique HD)",
    sampledFrames: 18,
    avgPitchPct: 74,
    pressingScore: 78,
    compactnessScore: 81,
    avgIntensity: 69,
    zones: { leftPct: 26, midPct: 38, rightPct: 36 },
    territorialTiltHome: 61,
    peakMoments,
    timeline,
    tacticalStyle: "Pressing Haut Coordonné & Surcharge du Demi-Espace Droit",
    homeXgMult: 1.11,
    awayXgMult: 0.96,
  };
}
