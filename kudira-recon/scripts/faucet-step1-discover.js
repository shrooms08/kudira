// Step 1 (reads) + endpoint discovery for the Cleanverse-native aUSDC test.
// NO dispense happens here: discovery probes omit required fields on purpose so
// they fail validation instead of sending tokens. Read-only + harmless probes.
//
//   node scripts/faucet-step1-discover.js

import "../src/lib/tls-compat.js"; // must be first

import { loadEnv } from "../load-env.js";
import { BASE_URL, post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID) {
  console.error("Missing CLEANVERSE_API_ID in .env");
  process.exit(1);
}

const api = (path, body) => post(`${BASE_URL}${path}`, body, { "api-id": API_ID });

const FAUCET_WALLET = "0xc448042edac1899b023caa0e9da5e4a8833de873";
const AUSDC = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";

// ---- Step 1a: verify_apass for the faucet wallet vs aUSDC -------------------
console.log("========== STEP 1: is the faucet wallet credentialed for aUSDC? ==========");
const ver = await api("/verify_apass", { chain: "base", atoken: AUSDC, address: FAUCET_WALLET });
console.log(`  verify_apass(${FAUCET_WALLET}) vs aUSDC:`);
console.log(`    http ${ver.httpStatus} code=${ver.body?.code} data.code=${ver.body?.data?.code} message=${ver.body?.data?.message ?? ver.body?.message}`);
console.log("    (data.code 4 = allowed, 2 = no A-Pass, 3 = expired/frozen)");

// also the single query_apass for a fuller picture
const qa = await api("/query_apass", { chain: "base", address: FAUCET_WALLET });
console.log(`  query_apass(${FAUCET_WALLET}): code=${qa.body?.code} ` +
  `tier=${JSON.stringify(qa.body?.data?.tier)} status=${JSON.stringify(qa.body?.data?.status)} ` +
  `message=${qa.body?.message ?? "-"}`);

// ---- Step 1b (discovery): which faucet endpoint exists? --------------------
// Probe with a body MISSING depositAddress + amount so a real endpoint returns a
// validation error (proving it exists) rather than dispensing anything.
console.log("\n========== DISCOVERY: locate the faucet endpoint (no dispense) ==========");
const candidates = [
  "/atoken/faucet",
  "/faucet",
  "/atoken/request_faucet",
  "/request_faucet",
  "/atoken/deposit",
  "/atoken/dispense",
];
for (const path of candidates) {
  const r = await api(path, { chain: "base", symbol: "usdc" }); // intentionally incomplete
  const code = r.body?.code ?? "(none)";
  const msg = r.body?.message ?? JSON.stringify(r.body)?.slice(0, 120);
  console.log(`  ${path.padEnd(24)} http ${r.httpStatus} code=${code} · ${msg}`);
}
console.log("\n  Read: an endpoint that EXISTS returns a validation/business error");
console.log("  (missing field, decrypt error, insufficient balance) rather than a");
console.log("  generic 'not found'. That is the one to fire the real request at.");
