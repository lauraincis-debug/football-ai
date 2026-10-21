// ============================================================
// SYNCHRONISATION FIREBASE REALTIME CLOUD (REST API LÉGÈRE)
// Permet de sauvegarder et restaurer la mémoire IA & le coupon
// entre plusieurs appareils (Mobile / PC) sur votre projet Firebase
// ============================================================

const SYNC_CFG_KEY = "football_ai_firebase_sync_cfg";

export function loadFirebaseSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CFG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {
    databaseUrl: import.meta.env.VITE_FIREBASE_DATABASE_URL || "",
    syncRoom: "mon-profil-ia",
  };
}

export function saveFirebaseSyncConfig(cfg) {
  try {
    localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

function buildEndpoint(databaseUrl, syncRoom) {
  const cleanUrl = String(databaseUrl || "").trim().replace(/\/+$/, "");
  const cleanRoom = String(syncRoom || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  if (!cleanUrl.startsWith("https://")) {
    throw new Error("URL Firebase Realtime Database invalide (doit commencer par https://).");
  }
  return `${cleanUrl}/football_ai_profiles/${cleanRoom}.json`;
}

export async function pushStateToFirebase(databaseUrl, syncRoom, payload) {
  const endpoint = buildEndpoint(databaseUrl, syncRoom);
  const res = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 2,
      updatedAt: new Date().toISOString(),
      ...payload,
    }),
  });
  if (!res.ok) {
    throw new Error(`Erreur Firebase (${res.status}) : vérifiez l'URL ou les règles Realtime DB.`);
  }
  return res.json();
}

export async function pullStateFromFirebase(databaseUrl, syncRoom) {
  const endpoint = buildEndpoint(databaseUrl, syncRoom);
  const res = await fetch(endpoint, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Erreur Firebase (${res.status}) lors de la récupération.`);
  }
  const data = await res.json();
  if (!data || !Array.isArray(data.predictions)) {
    throw new Error("Aucune sauvegarde trouvée sur ce profil Cloud.");
  }
  return data;
}
