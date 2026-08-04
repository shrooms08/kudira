// GATE 2 + GATE 3 recon for a possible aUSDC settlement switch.
// Read-only. No writes, no key material. Prints raw responses so field names
// (depositUSDCWallet, whitelist entries) are read from the server, not guessed.
//
//   node scripts/probe-deposit-whitelist.js

import "../src/lib/tls-compat.js"; // must be first: fixes the TLS handshake

import { loadEnv } from "../load-env.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID) {
  console.error("Missing CLEANVERSE_API_ID in .env");
  process.exit(1);
}

const BASE = "https://uatapi.cleanverse.com/api/cooperate";
const POOL = "0x4a898781AFAd85BE7103126952BcBbFCCC24199e";

async function call(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-id": API_ID },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _raw: text };
    }
    return { httpStatus: res.status, json };
  } catch (err) {
    return { error: err?.name === "AbortError" ? "timeout" : String(err?.cause?.code ?? err.message) };
  } finally {
    clearTimeout(timer);
  }
}

function show(label, r) {
  console.log(`\n### ${label}`);
  if (r.error) {
    console.log(`  transport error: ${r.error}`);
    return;
  }
  console.log(`  http ${r.httpStatus} · code=${r.json?.code ?? "?"} · message=${r.json?.message ?? "?"}`);
  console.log(JSON.stringify(r.json?.data ?? r.json, null, 2));
}

// ---- GATE 2: our pool's deposit address on base ----------------------------
console.log("========== GATE 2: query_deposit_address (pool, base) ==========");
for (const body of [
  { chain: "base", address: POOL },
  { chain: "base", walletAddress: POOL },
  { chain: "base", wallet: POOL },
  { chain: "base", userAddress: POOL },
]) {
  const r = await call("query_deposit_address", body);
  show(`body=${JSON.stringify(body)}`, r);
  // stop at the first shape the server accepts (code 0000)
  if (r.json?.code === "0000") break;
}

// ---- GATE 3: institution whitelist on base ---------------------------------
console.log("\n\n========== GATE 3: query_institution_white_list (base) ==========");
for (const body of [
  { chain: "base" },
  { chain: "base", page: 1, pageSize: 50 },
  { chain: "base", pair: "usdc_ausdc" },
]) {
  const r = await call("query_institution_white_list", body);
  show(`body=${JSON.stringify(body)}`, r);
  if (r.json?.code === "0000") break;
}
