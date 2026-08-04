// Decisive aUSDC Travel Rule test — funding leg.
// 1. query_deposit_address for the treasury EOA
// 2. verify_apass for treasury + merchant vs aUSDC (both must be code 4, or the
//    treasury->merchant transfer would revert NoAPass)
// 3. fire ONE /faucet request into the treasury's deposit address
// Read-only except the single faucet dispense.
//
//   node scripts/treasury-ausdc-fund.js

import "../src/lib/tls-compat.js"; // must be first

import { loadEnv } from "../load-env.js";
import { BASE_URL, h2Post, post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID) {
  console.error("Missing CLEANVERSE_API_ID in .env");
  process.exit(1);
}
const api = (path, body) => post(`${BASE_URL}${path}`, body, { "api-id": API_ID });

const TREASURY = "0x021Fed3a7d7367B3d4Da7812B38355014AFc808F";
const MERCHANT = "0xE8D7b7CEDC7b114D56E7828C7179c6a9b9EEe06D";
const AUSDC = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";

// --- 1. deposit address for the treasury ---
const dep = await api("/query_deposit_address", { chain: "base", address: TREASURY });
const depositWallet = dep.body?.data?.depositUSDCWallet;
console.log("## 1. query_deposit_address(treasury)");
console.log(`   code=${dep.body?.code} depositUSDCWallet=${depositWallet}`);
if (!depositWallet) {
  console.error("   ✖ no depositUSDCWallet; aborting");
  process.exit(1);
}

// --- 2. both EOAs credentialed vs aUSDC? ---
console.log("\n## 2. verify_apass vs aUSDC (need code 4 both)");
for (const [label, addr] of [["treasury", TREASURY], ["merchant", MERCHANT]]) {
  const v = await api("/verify_apass", { chain: "base", atoken: AUSDC, address: addr });
  console.log(`   ${label.padEnd(9)} ${addr}  data.code=${v.body?.data?.code} (${v.body?.data?.message ?? v.body?.message})`);
}

// --- 3. fire ONE faucet request into the treasury deposit wallet ---
const body = { chain: "base", symbol: "usdc", depositAddress: depositWallet, amount: "5" };
console.log(`\n## 3. fire /faucet  ${JSON.stringify(body)}`);
const res = await h2Post("/faucet", body, { "api-id": API_ID }, 90_000);
if (res.error) {
  console.log(`   transport error: ${res.error}`);
} else {
  console.log(`   http ${res.httpStatus} code=${res.body?.code} amount=${res.body?.data?.amount} tx=${res.body?.data?.tx_hash}`);
}
console.log(`\nDEPOSIT_WALLET=${depositWallet}`);
