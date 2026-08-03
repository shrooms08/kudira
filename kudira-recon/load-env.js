// Minimal .env loader shared by the recon probes.
// Prefers Node's built-in loader (20.12+); falls back to a manual parse so this
// runs on any Node 20+ without a dependency.

import { readFileSync } from "node:fs";

export function loadEnv(url) {
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(url);
      return;
    } catch {
      // fall through to manual parse
    }
  }
  let text;
  try {
    text = readFileSync(url, "utf8");
  } catch {
    console.warn("! Could not read .env — relying on existing process env.");
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
