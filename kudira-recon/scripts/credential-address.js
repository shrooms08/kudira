// Issue an A-Pass to one address and PROVE it is ours before reporting success.
//
// aUSDC gates transfers on both sender and recipient, so every address in the
// money path needs a credential. This is the tool that issues them, one at a
// time, with the full verification discipline:
//
//   pre-check not-found -> issue (HTTP/2, encrypted) -> ownership proof via
//   query_apass_list on exact customerId + chain + wallet -> verify_apass == 4
//
// Never infer that a write succeeded from a record we did not create.
//
// Usage:
//   node scripts/credential-address.js <address> <LABEL> [subTier]
//
// LABEL is folded into the customerId for auditability. Default subTier 80.
// Exits non-zero on any failure. SYNTHETIC DATA ONLY.

import "../src/lib/tls-compat.js"; // must be first

import { randomBytes } from "node:crypto";

import { loadEnv } from "../load-env.js";
import { encrypt } from "../src/lib/cleanverse-crypto.js";
import { BASE_URL, h2Post, post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID || !process.env.CLEANVERSE_API_KEY) {
  console.error("Missing credentials in .env");
  process.exit(1);
}

const ADDRESS = process.argv[2];
const LABEL = (process.argv[3] ?? "ADDR").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const SUB_TIER = Number(process.argv[4] ?? 80);

if (!ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(ADDRESS)) {
  console.error("Usage: node scripts/credential-address.js <address> <LABEL> [subTier]");
  process.exit(1);
}

const CHAIN = "base";
// Verify against the asset the pool actually settles in. Checking a different
// A-Token proves nothing about this pool's money path.
const AUSDC = process.env.SETTLEMENT_ASSET ?? "0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E";

const api = (path, body) => post(`${BASE_URL}${path}`, body, { "api-id": API_ID });
const indent = (o) => JSON.stringify(o, null, 2).split("\n").map((l) => "    " + l).join("\n");

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomAlnum(n) {
  const b = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALNUM[b[i] % ALNUM.length];
  return out;
}

const customerId = `KUDIRA${LABEL}${randomAlnum(10)}`;
if (customerId.length < 12 || !/^[A-Za-z0-9]+$/.test(customerId)) {
  console.error(`Generated customerId is invalid: ${customerId}`);
  process.exit(1);
}

console.log(`\nCredentialing ${LABEL}`);
console.log(`  address:    ${ADDRESS}`);
console.log(`  customerId: ${customerId}`);
console.log(`  subTier:    ${SUB_TIER}`);

// --- Pre-check: must not already hold a credential ----------------------------
const pre = await api("/query_apass", { chain: CHAIN, address: ADDRESS });
const preCode = pre.body?.code;
if (preCode === "0000") {
  console.log("  pre-check:  ALREADY HAS AN A-PASS — refusing to issue.");
  console.log(indent(pre.body?.data));
  console.log("  A pre-existing record cannot be attributed to us. Verify it by hand,");
  console.log("  or use override with the original customerId if it is ours.");
  process.exit(3);
}
console.log(`  pre-check:  no existing record (code ${preCode}) ✓`);

// --- Issue --------------------------------------------------------------------
const requestObject = {
  customerId,
  expirationTime: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  wallet: { address: ADDRESS, chain: CHAIN },
  identityDataList: [
    { idType: "PASSPORT", fullName: "Test Entity", idNumber: "TESTONLY0003", issuingCountryISO2: "SG" },
  ],
  subTier: SUB_TIER,
  override: false,
};

const gen = await h2Post("/generate_apass", { data: encrypt(requestObject) }, { "api-id": API_ID });
if (gen.error) {
  console.log(`  write:      no HTTP response (${gen.error}) — read-back will decide`);
} else {
  console.log(`  write:      http ${gen.httpStatus} code ${gen.body?.code}`);
  const hay = JSON.stringify(gen.body ?? "").toLowerCase();
  if (gen.httpStatus === 403 || hay.includes("decrypt")) {
    console.log(indent(gen.body));
    console.error("  ✖ FAIL: write rejected");
    process.exit(1);
  }
  if (gen.body?.data?.txHash) console.log(`  txHash:     ${gen.body.data.txHash}`);
}

// --- Ownership proof ----------------------------------------------------------
let record = null;
for (let attempt = 1; attempt <= 10 && !record; attempt++) {
  for (let page = 1; page <= 3 && !record; page++) {
    const r = await api("/query_apass_list", { chain: CHAIN, page, pageSize: 50 });
    record = (r.body?.data?.items ?? []).find((i) => i.customerId === customerId) ?? null;
  }
  if (!record) await new Promise((res) => setTimeout(res, 5000));
}

if (!record) {
  console.error("  ✖ FAIL: no record with our exact customerId appeared");
  process.exit(1);
}

const checks = {
  "customerId matches exactly": record.customerId === customerId,
  'chain === "base"': record.chain === CHAIN,
  "wallet matches": (record.walletAddress ?? "").toLowerCase() === ADDRESS.toLowerCase(),
};
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
if (!Object.values(checks).every(Boolean)) {
  console.error("  ✖ FAIL: ownership checks did not pass");
  process.exit(1);
}
console.log(
  `  stored:     tier=${JSON.stringify(record.tier)} (${typeof record.tier})  ` +
    `subTier=${JSON.stringify(record.subTier)} (${typeof record.subTier})  cvRecordId=${record.cvRecordId}`,
);

// --- verify_apass against aUSDC ----------------------------------------------
// The list record can land before the on-chain mint is visible to verify_apass,
// which briefly reports code 2 ("apass not exist"). Poll rather than reading
// once: a single early read looks identical to a genuine failure.
let code = null;
for (let attempt = 1; attempt <= 12; attempt++) {
  const ver = await api("/verify_apass", { chain: CHAIN, atoken: AUSDC, address: ADDRESS });
  code = ver.body?.code === "0000" ? ver.body?.data?.code : null;
  if (code === 4) {
    console.log(`  verify_apass.data.code = 4${attempt > 1 ? ` (after ${attempt} polls)` : ""}`);
    break;
  }
  console.log(`  verify_apass.data.code = ${code ?? "no verdict"} — waiting for the mint (${attempt}/12)`);
  if (attempt < 12) await new Promise((r) => setTimeout(r, 10_000));
}
if (code !== 4) {
  console.error(`  ✖ FAIL: required code 4, got ${code ?? "no verdict"} after polling`);
  process.exit(1);
}

console.log(`  ✓ ${LABEL} credentialed and verified (customerId ${customerId})\n`);
