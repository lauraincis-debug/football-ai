#!/usr/bin/env node
/**
 * ⚡ FOOTBALL AI ULTRA — Déploiement Direct Firebase Hosting (Spécial Cloud Shell Mobile)
 * Publie directement le dossier compilé ./www vers Firebase Hosting via l'API REST officielle
 * en utilisant la session Google déjà active de Cloud Shell (ZÉRO popup, ZÉRO changement d'onglet !).
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const WWW_DIR = path.join(ROOT_DIR, "www");

function askQuestion(query) {
  let input = process.stdin;
  let openedTty = false;
  try {
    input = fs.createReadStream("/dev/tty");
    openedTty = true;
  } catch {
    input = process.stdin;
  }
  const rl = readline.createInterface({ input, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      if (openedTty && typeof input.destroy === "function") input.destroy();
      resolve(ans.trim());
    })
  );
}

function getAccessToken() {
  return execSync("gcloud auth print-access-token", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function apiRequest(url, { method = "GET", token, quotaProject, body, rawBody, headers = {} }) {
  const reqHeaders = {
    Authorization: `Bearer ${token}`,
    ...(quotaProject ? { "x-goog-user-project": quotaProject } : {}),
    ...headers,
  };
  let payload = rawBody;
  if (body !== undefined) {
    reqHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers: reqHeaders, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, data: json };
}

function walkFiles(dir, baseDir = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, baseDir));
    } else if (entry.isFile()) {
      const rel = "/" + path.relative(baseDir, full).split(path.sep).join("/");
      results.push({ fullPath: full, webPath: rel });
    }
  }
  return results;
}

async function resolveProjectId(token, cliArg) {
  if (cliArg) return cliArg;

  // 1. Lire en priorité le projet pré-configuré dans .firebaserc (ex: football-ai-43e33)
  try {
    const rcPath = path.join(ROOT_DIR, ".firebaserc");
    if (fs.existsSync(rcPath)) {
      const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));
      const configured = rc?.projects?.default;
      if (configured && !configured.includes("REMPLACER")) {
        console.log(`✓ Projet Firebase pré-configuré détecté (.firebaserc) : ${configured}`);
        return configured;
      }
    }
  } catch {
    // ignore
  }

  // 2. Vérifier si un projet est déjà actif dans gcloud
  try {
    const current = execSync("gcloud config get-value project 2>/dev/null", {
      encoding: "utf8",
    }).trim();
    if (current && current !== "(unset)") {
      console.log(`✓ Projet Google Cloud actif détecté : ${current}`);
      return current;
    }
  } catch {
    // ignore
  }

  // Lister automatiquement les projets existants du compte Google
  const listRes = await apiRequest(
    "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE",
    { token }
  );
  const projects = listRes.data?.projects || [];

  if (projects.length === 1) {
    console.log(`✓ Projet unique trouvé automatiquement : ${projects[0].projectId}`);
    return projects[0].projectId;
  }

  if (projects.length > 1) {
    console.log("\n📋 Vos projets Google / Firebase disponibles :");
    projects.forEach((p, idx) => {
      console.log(`  [${idx + 1}] ${p.projectId} (${p.name || p.projectId})`);
    });
    const choice = await askQuestion(
      `\nTapez le numéro [1-${projects.length}] (ou appuyez sur Entrée pour prendre [1] ${projects[0].projectId}) : `
    );
    if (!choice) return projects[0].projectId;
    const num = parseInt(choice, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= projects.length) {
      return projects[num - 1].projectId;
    }
    return choice;
  }

  // Aucun projet existant -> création automatique d'un projet neuf !
  const generatedId = `football-ai-${Math.floor(10000 + Math.random() * 89999)}`;
  console.log(`\n✨ Aucun projet trouvé : création automatique du projet "${generatedId}"...`);
  try {
    execSync(`gcloud projects create ${generatedId} --name="Football AI Ultra"`, {
      stdio: "inherit",
    });
    return generatedId;
  } catch {
    const manual = await askQuestion(
      "Créez un projet sur https://console.firebase.google.com puis entrez son ID ici : "
    );
    return manual;
  }
}

async function main() {
  console.log("\n========================================================");
  console.log(" ⚡ DÉPLOIEMENT EXPRESS FIREBASE HOSTING (CLOUD SHELL)");
  console.log("========================================================\n");

  if (!fs.existsSync(WWW_DIR)) {
    console.log("🔨 Construction du dossier www/...");
    execSync("npm install --no-audit --no-fund && npm run build", {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
  }

  const token = getAccessToken();
  const projectId = await resolveProjectId(token, process.argv[2]);
  if (!projectId) {
    console.error("❌ Aucun ID de projet disponible.");
    process.exit(1);
  }

  execSync(`gcloud config set project ${projectId}`, { stdio: "ignore" });
  fs.writeFileSync(
    path.join(ROOT_DIR, ".firebaserc"),
    JSON.stringify({ projects: { default: projectId } }, null, 2)
  );

  console.log(`⚙️ Activation de l'API Firebase Hosting sur "${projectId}"...`);
  execSync(
    `gcloud services enable serviceusage.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com --project=${projectId}`,
    { stdio: "inherit" }
  );

  // Rafraîchir le token après activation
  const freshToken = getAccessToken();

  // Rattacher Firebase au projet si nécessaire (idempotent)
  await apiRequest(`https://firebase.googleapis.com/v1beta1/projects/${projectId}:addFirebase`, {
    method: "POST",
    token: freshToken,
    quotaProject: projectId,
    body: {},
  });

  // Récupérer ou créer le site Firebase Hosting par défaut
  let siteId = projectId;
  const sitesRes = await apiRequest(
    `https://firebasehosting.googleapis.com/v1beta1/projects/${projectId}/sites`,
    { token: freshToken, quotaProject: projectId }
  );
  const existingSites = sitesRes.data?.sites || [];
  if (existingSites.length > 0) {
    const defSite = existingSites.find((s) => s.type === "DEFAULT_SITE") || existingSites[0];
    siteId = defSite.name.split("/").pop();
  } else {
    const createSite = await apiRequest(
      `https://firebasehosting.googleapis.com/v1beta1/projects/${projectId}/sites?siteId=${projectId}`,
      { method: "POST", token: freshToken, quotaProject: projectId, body: {} }
    );
    if (createSite.data?.name) {
      siteId = createSite.data.name.split("/").pop();
    }
  }

  console.log(`📦 Préparation et compression GZIP des fichiers de production (${WWW_DIR})...`);
  const allFiles = walkFiles(WWW_DIR);
  const fileHashes = {};
  const gzipByHash = new Map();

  for (const f of allFiles) {
    const raw = fs.readFileSync(f.fullPath);
    const gz = zlib.gzipSync(raw, { level: 9 });
    const sha256 = crypto.createHash("sha256").update(gz).digest("hex");
    fileHashes[f.webPath] = sha256;
    gzipByHash.set(sha256, gz);
  }

  // 1. Créer une nouvelle version Firebase Hosting
  const verRes = await apiRequest(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}/versions`,
    {
      method: "POST",
      token: freshToken,
      quotaProject: projectId,
      body: {
        config: {
          rewrites: [{ glob: "**", path: "/index.html" }],
          headers: [
            {
              glob: "/cloe-bridge.js",
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Cache-Control": "no-cache",
              },
            },
            {
              glob: "/assets/**",
              headers: { "Cache-Control": "public, max-age=31536000, immutable" },
            },
            {
              glob: "/index.html",
              headers: { "Cache-Control": "no-cache" },
            },
            {
              glob: "/sw.js",
              headers: { "Cache-Control": "no-cache" },
            },
          ],
        },
      },
    }
  );

  if (!verRes.ok || !verRes.data?.name) {
    throw new Error(
      `Impossible d'initialiser la version Firebase Hosting (${verRes.status}) : ${JSON.stringify(verRes.data)}`
    );
  }
  const versionName = verRes.data.name;

  // 2. Déclarer les empreintes SHA-256 des fichiers
  const popRes = await apiRequest(
    `https://firebasehosting.googleapis.com/v1beta1/${versionName}:populateFiles`,
    {
      method: "POST",
      token: freshToken,
      quotaProject: projectId,
      body: { files: fileHashes },
    }
  );
  if (!popRes.ok) {
    throw new Error(`Erreur populateFiles (${popRes.status}) : ${JSON.stringify(popRes.data)}`);
  }

  const requiredHashes = popRes.data?.uploadRequiredHashes || [];
  const uploadUrl = popRes.data?.uploadUrl;

  // 3. Envoyer sur le CDN Google les fichiers requis
  if (requiredHashes.length > 0 && uploadUrl) {
    console.log(`🚀 Envoi de ${requiredHashes.length} fichier(s) sur les serveurs Firebase...`);
    for (const h of requiredHashes) {
      const up = await apiRequest(`${uploadUrl}/${h}`, {
        method: "POST",
        token: freshToken,
        quotaProject: projectId,
        rawBody: gzipByHash.get(h),
        headers: { "Content-Type": "application/octet-stream" },
      });
      if (!up.ok) {
        throw new Error(`Échec upload fichier ${h} (${up.status})`);
      }
    }
  }

  // 4. Finaliser la version
  const finRes = await apiRequest(
    `https://firebasehosting.googleapis.com/v1beta1/${versionName}?updateMask=status`,
    {
      method: "PATCH",
      token: freshToken,
      quotaProject: projectId,
      body: { status: "FINALIZE" },
    }
  );
  if (!finRes.ok) {
    throw new Error(`Échec finalisation (${finRes.status}) : ${JSON.stringify(finRes.data)}`);
  }

  // 5. Publier en production sur le canal Live
  const relRes = await apiRequest(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}/releases?versionName=${encodeURIComponent(versionName)}`,
    {
      method: "POST",
      token: freshToken,
      quotaProject: projectId,
      body: { message: "Football AI Ultra v3 — Production Release" },
    }
  );
  if (!relRes.ok) {
    throw new Error(`Échec mise en ligne (${relRes.status}) : ${JSON.stringify(relRes.data)}`);
  }

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  🎉 FÉLICITATIONS ! VOTRE APPLICATION EST EN LIGNE !        ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  🌐 Lien direct : https://${siteId}.web.app`);
  console.log(`║  🔗 Lien miroir : https://${siteId}.firebaseapp.com`);
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
}

main().catch((err) => {
  console.error("\n⚠️ Bascule automatique vers Firebase CLI standard :", err.message);
  try {
    execSync("./deploy-firebase.sh", { cwd: ROOT_DIR, stdio: "inherit" });
  } catch {
    process.exit(1);
  }
});
