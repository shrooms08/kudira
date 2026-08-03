// Re-issue an existing A-Pass at a new subTier, keeping the same customerId.
//
// This is the Kudira grade-publish path: `override: true` updates the record in
// place (operate: "update", cvRecordId unchanged) rather than creating a second
// row. Gate 1 proved `tier` is untouched by this, so a subTier change can never
// push a holder below the token's min_tier and block their transfers.
//
// Usage:
//   node scripts/reissue-apass.js <address> <existingCustomerId> <subTier>
//
// Verifies the record actually reaches the requested subTier before returning.

import "../src/lib/tls-compat.js"; // must be first

import { loadEnv } from "../load-env.js";
import { encrypt } from "../src/lib/cleanverse-crypto.js";
import { BASE_URL, h2Post, post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID || !process.env.CLEANVERSE_API_KEY) {
  console.error("Missing credentials in .env");
  process.exit(1);
}

const [ADDRESS, CUSTOMER_ID, SUB_TIER_RAW] = process.argv.slice(2);
const SUB_TIER = Number(SUB_TIER_RAW);
if (!ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(ADDRESS) || !CUSTOMER_ID || !Number.isInteger(SUB_TIER)) {
  console.error("Usage: node scripts/reissue-apass.js <address> <customerId> <subTier>");
  process.exit(1);
}

const CHAIN = "base";
const SETTLEMENT_ASSET = process.env.SETTLEMENT_ASSET ?? "0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E";
const api = (path, body) => post(`${BASE_URL}${path}`, body, { "api-id": API_ID });

// Read the current record so expirationTime and identity stay identical — only
// subTier changes.
async function currentRecord() {
  for (let page = 1; page <= 3; page++) {
    const r = await api("/query_apass_list", { chain: CHAIN, page, pageSize: 50 });
    const hit = (r.body?.data?.items ?? []).find(
      (i) => i.customerId === CUSTOMER_ID && (i.walletAddress ?? "").toLowerCase() === ADDRESS.toLowerCase(),
    );
    if (hit) return hit;
  }
  return null;
}

console.log(`\nRe-issuing A-Pass  ${ADDRESS}`);
console.log(`  customerId: ${CUSTOMER_ID}`);

const before = await currentRecord();
if (!before) {
  console.error("  ✖ FAIL: no record matching that customerId + wallet. Refusing to write.");
  process.exit(1);
}
console.log(`  before:     tier=${JSON.stringify(before.tier)} subTier=${before.subTier} cvRecordId=${before.cvRecordId}`);
console.log(`  target:     subTier ${SUB_TIER}`);

const body = {
  customerId: CUSTOMER_ID,
  expirationTime: before.expirationTime,
  wallet: { address: ADDRESS, chain: CHAIN },
  identityDataList: [
    { idType: "PASSPORT", fullName: "Test Entity", idNumber: "TESTONLY0003", issuingCountryISO2: "SG" },
  ],
  subTier: SUB_TIER,
  override: true,
};

const res = await h2Post("/generate_apass", { data: encrypt(body) }, { "api-id": API_ID });
if (res.error) {
  console.log(`  write:      no HTTP response (${res.error}) — read-back will decide`);
} else {
  console.log(`  write:      http ${res.httpStatus} code ${res.body?.code} operate=${res.body?.data?.wallet?.operate}`);
  if (res.body?.data?.wallet?.txHash) console.log(`  txHash:     ${res.body.data.wallet.txHash}`);
}

let after = null;
for (let i = 1; i <= 12; i++) {
  after = await currentRecord();
  if (after && after.subTier === SUB_TIER) break;
  console.log(`  waiting for subTier ${SUB_TIER} (${i}/12), currently ${after?.subTier}`);
  await new Promise((r) => setTimeout(r, 6000));
}

if (!after || after.subTier !== SUB_TIER) {
  console.error(`  ✖ FAIL: subTier is ${after?.subTier}, expected ${SUB_TIER}`);
  process.exit(1);
}

console.log(
  `  after:      tier=${JSON.stringify(after.tier)} (${typeof after.tier})  ` +
    `subTier=${after.subTier} (${typeof after.subTier})  cvRecordId=${after.cvRecordId}`,
);
if (after.cvRecordId === before.cvRecordId) {
  console.log("  ✓ updated in place — same cvRecordId, no duplicate row");
}
if (after.tier === before.tier) {
  console.log(`  ✓ tier unchanged at ${JSON.stringify(after.tier)} — transfers stay possible`);
}

const ver = await api("/verify_apass", { chain: CHAIN, atoken: SETTLEMENT_ASSET, address: ADDRESS });
console.log(`  verify_apass vs settlement asset: data.code = ${ver.body?.data?.code}`);
console.log("");
