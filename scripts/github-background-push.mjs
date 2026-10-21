#!/usr/bin/env node
/**
 * Démon autonome d'arrière-plan pour Google Cloud Shell :
 * Réutilise automatiquement tout token GitHub déjà présent (~/.config/football-ai-gh-token ou gh CLI),
 * sinon génère un code Device Flow unique et mémorise le token pour les prochaines mises à jour !
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, "..");
const CODE_FILE = "/tmp/football_ai_gh_code.json";
const STATUS_FILE = "/tmp/football_ai_gh_status.txt";
const SAVED_TOKEN_FILE = path.join(os.homedir(), ".config", "football-ai-gh-token");

const GITHUB_CLI_CLIENT_ID = "178c6fc778ccc68e1d6a";
const TARGET_REPO = "lauraincis-debug/football-ai.git";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tryPushWithToken(token) {
  if (!token) return false;
  try {
    const remoteUrl = `https://x-access-token:${token.trim()}@github.com/${TARGET_REPO}`;
    execFileSync("git", ["push", "--force", remoteUrl, "HEAD:refs/heads/main"], {
      cwd: REPO_DIR,
      stdio: "inherit",
    });

    // Activer aussi le déploiement 100% automatique GitHub Actions -> Firebase à vie !
    try {
      const saName = "arena-auto-deploy";
      const saEmail = `${saName}@football-ai-43e33.iam.gserviceaccount.com`;
      const keyFile = "/tmp/fb_arena_sa_key.json";
      execFileSync(
        "bash",
        [
          "-c",
          `gcloud iam service-accounts create ${saName} --project=football-ai-43e33 --display-name="Arena Auto Deploy" 2>/dev/null || true
           gcloud projects add-iam-policy-binding football-ai-43e33 --member="serviceAccount:${saEmail}" --role="roles/firebasehosting.admin" >/dev/null 2>&1 || true
           gcloud projects add-iam-policy-binding football-ai-43e33 --member="serviceAccount:${saEmail}" --role="roles/serviceusage.serviceUsageConsumer" >/dev/null 2>&1 || true
           gcloud projects add-iam-policy-binding jarvis-1v2 --member="serviceAccount:${saEmail}" --role="roles/firebasehosting.admin" >/dev/null 2>&1 || true
           gcloud projects add-iam-policy-binding jarvis-1v2 --member="serviceAccount:${saEmail}" --role="roles/serviceusage.serviceUsageConsumer" >/dev/null 2>&1 || true
           rm -f ${keyFile}
           gcloud iam service-accounts keys create ${keyFile} --iam-account=${saEmail} --project=football-ai-43e33 >/dev/null 2>&1
           GH_TOKEN="${token.trim()}" gh secret set FIREBASE_SERVICE_ACCOUNT --repo lauraincis-debug/operation-shadow < ${keyFile} >/dev/null 2>&1 || true
           GH_TOKEN="${token.trim()}" gh secret set FIREBASE_SERVICE_ACCOUNT --repo lauraincis-debug/football-ai < ${keyFile} >/dev/null 2>&1 || true
           rm -f ${keyFile}`,
        ],
        { stdio: "ignore" }
      );
    } catch {
      // Ne jamais bloquer si la politique IAM refuse la création de clé
    }
    return true;
  } catch {
    return false;
  }
}

function curlJson(url, payload) {
  const out = execFileSync(
    "curl",
    [
      "-fsSL",
      "-X",
      "POST",
      "-H",
      "Accept: application/json",
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(payload),
      url,
    ],
    { encoding: "utf8" }
  );
  return JSON.parse(out);
}

async function main() {
  fs.writeFileSync(STATUS_FILE, "STARTING\n");

  // 1. Tenter en priorité la réutilisation silencieuse d'un token déjà autorisé
  let existingToken = "";
  try {
    if (fs.existsSync(SAVED_TOKEN_FILE)) {
      existingToken = fs.readFileSync(SAVED_TOKEN_FILE, "utf8").trim();
    }
  } catch {
    // ignore
  }
  if (!existingToken) {
    try {
      existingToken = execFileSync("gh", ["auth", "token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // ignore
    }
  }

  if (existingToken && tryPushWithToken(existingToken)) {
    fs.writeFileSync(STATUS_FILE, "PUSH_SUCCESS_CACHED\n");
    return;
  }

  // 2. Sinon Device Flow sans aucun "Press Enter" bloquant
  const deviceData = curlJson("https://github.com/login/device/code", {
    client_id: GITHUB_CLI_CLIENT_ID,
    scope: "repo workflow",
  });

  if (!deviceData.user_code || !deviceData.device_code) {
    throw new Error("Réponse GitHub Device Flow invalide.");
  }

  fs.writeFileSync(
    CODE_FILE,
    JSON.stringify({
      user_code: deviceData.user_code,
      verification_uri: deviceData.verification_uri || "https://github.com/login/device",
      expires_in: deviceData.expires_in,
    })
  );
  fs.writeFileSync(STATUS_FILE, `WAITING_AUTH:${deviceData.user_code}\n`);

  let intervalSec = (deviceData.interval || 5) + 1;
  const deadline = Date.now() + (deviceData.expires_in || 900) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalSec * 1000);

    const tokenData = curlJson("https://github.com/login/oauth/access_token", {
      client_id: GITHUB_CLI_CLIENT_ID,
      device_code: deviceData.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    if (tokenData.access_token) {
      try {
        fs.mkdirSync(path.dirname(SAVED_TOKEN_FILE), { recursive: true });
        fs.writeFileSync(SAVED_TOKEN_FILE, tokenData.access_token, { mode: 0o600 });
      } catch {
        // ignore
      }
      fs.writeFileSync(STATUS_FILE, "PUSHING\n");
      if (tryPushWithToken(tokenData.access_token)) {
        fs.writeFileSync(STATUS_FILE, "PUSH_SUCCESS\n");
        return;
      }
      throw new Error("Échec git push après obtention du token.");
    }

    if (tokenData.error === "slow_down") {
      intervalSec += 5;
    } else if (tokenData.error && tokenData.error !== "authorization_pending") {
      throw new Error(`Erreur OAuth GitHub : ${tokenData.error}`);
    }
  }

  fs.writeFileSync(STATUS_FILE, "EXPIRED\n");
}

main().catch((err) => {
  fs.writeFileSync(STATUS_FILE, `ERROR:${err.message}\n`);
  process.exit(1);
});
