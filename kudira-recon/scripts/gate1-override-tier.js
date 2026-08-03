// PHASE 2, GATE 1 — does `override: true` re-issue preserve `tier`?
//
// The risk: Kudira's default penalty is a subTier downgrade. But aUSDC gates
// transfers on `tier` (min_tier 5, strictly greater), NOT on subTier. If a
// re-issue that lowers subTier also drags `tier` down to 5 or below, a
// downgraded borrower can no longer transfer aUSDC — which means they can no
// longer REPAY. Punishing a late payer by making repayment impossible is an
// enforcement design that eats itself.
//
// This re-issues our own probe record at descending subTiers and watches what
// happens to `tier` and to verify_apass at each step.
//
// Usage: node scripts/gate1-override-tier.js
// Sandbox read/write only. No deploys.

import "../src/lib/tls-compat.js"; // must be first: fixes the TLS handshake to the sandbox

import { loadEnv } from "../load-env.js";
import { encrypt } from "../src/lib/cleanverse-crypto.js";
import { BASE_URL, h2Post, post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID || !process.env.CLEANVERSE_API_KEY) {
  console.error("Missing credentials. Set CLEANVERSE_API_ID and CLEANVERSE_API_KEY in .env");
  process.exit(1);
}

const CHAIN = "base";
const AUSDC = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";
/// The Gate 0 probe. Already credentialed: tier "50", subTier 80.
const PROBE = "0xe483EC702367aEc951162b91905c8c52ac45c9C9";
const CUSTOMER_ID = "KUDIRAPROBE4n0aJFkc6NXr";
/// Identical to the original issuance, so subTier is the only variable.
const EXPIRATION_TIME = 1817286682;
/// aUSDC's rule: min_tier 5, strictly greater. tier must be >= 6.
const AUSDC_MIN_TIER = 5;

const api = (path, body) => post(`${BASE_URL}${path}`, body, { "api-id": API_ID });
const indent = (o) => JSON.stringify(o, null, 2).split("\n").map((l) => "    " + l).join("\n");

function baseRequest(subTier) {
  return {
    customerId: CUSTOMER_ID,
    expirationTime: EXPIRATION_TIME,
    wallet: { address: PROBE, chain: CHAIN },
    identityDataList: [
      { idType: "PASSPORT", fullName: "Test Entity", idNumber: "TESTONLY0002", issuingCountryISO2: "SG" },
    ],
    subTier,
    override: true, // re-issue over our own record
  };
}

/// Newest record carrying our exact customerId AND wallet. Never trust a record
/// we did not create; override can leave several rows with the same customerId.
async function readRecord() {
  for (let page = 1; page <= 3; page++) {
    const r = await api("/query_apass_list", { chain: CHAIN, page, pageSize: 50 });
    const items = r.body?.data?.items ?? [];
    const match = items.find(
      (i) =>
        i.customerId === CUSTOMER_ID && (i.walletAddress ?? "").toLowerCase() === PROBE.toLowerCase(),
    );
    if (match) return match;
  }
  return null;
}

async function verifyApass() {
  const r = await api("/verify_apass", { chain: CHAIN, atoken: AUSDC, address: PROBE });
  return r.body?.code === "0000" ? (r.body?.data?.code ?? null) : null;
}

const results = [];

async function snapshot(label) {
  const rec = await readRecord();
  const code = await verifyApass();
  const row = {
    label,
    tier: rec?.tier,
    tierType: typeof rec?.tier,
    subTier: rec?.subTier,
    subTierType: typeof rec?.subTier,
    cvRecordId: rec?.cvRecordId,
    verifyCode: code,
  };
  results.push(row);
  console.log(
    `  tier=${JSON.stringify(row.tier)} (${row.tierType})  ` +
      `subTier=${JSON.stringify(row.subTier)} (${row.subTierType})  ` +
      `cvRecordId=${row.cvRecordId}  verify_apass.data.code=${row.verifyCode}`,
  );
  return row;
}

async function reissue(subTier) {
  console.log(`\n--- re-issue with override:true, subTier: ${subTier} ---`);
  const res = await h2Post("/generate_apass", { data: encrypt(baseRequest(subTier)) }, { "api-id": API_ID });
  if (res.error) {
    console.log(`  (no HTTP response: ${res.error}) — read-back will decide`);
  } else {
    console.log(`  http ${res.httpStatus}`);
    console.log(indent(res.body));
  }

  // Wait for the requested subTier to land, so we never read a stale row.
  let row = null;
  for (let i = 1; i <= 10; i++) {
    row = await readRecord();
    if (row && row.subTier === subTier) break;
    await new Promise((r) => setTimeout(r, 5000));
    console.log(`  waiting for subTier ${subTier} to appear (attempt ${i})`);
  }
  console.log("  after re-issue:");
  return snapshot(`override subTier=${subTier}`);
}

// --- Run ----------------------------------------------------------------------

console.log("\nPHASE 2 GATE 1 — does override re-issue preserve tier?");
console.log(`  probe:      ${PROBE}`);
console.log(`  customerId: ${CUSTOMER_ID}`);
console.log(`  aUSDC rule: min_tier ${AUSDC_MIN_TIER}, strictly greater => tier must be >= ${AUSDC_MIN_TIER + 1}\n`);

console.log("=== baseline (before any override) ===");
await snapshot("baseline");

await reissue(40);
await reissue(5);

// --- Verdict ------------------------------------------------------------------

console.log("\n" + "=".repeat(78));
console.log("SUMMARY\n");
console.log(
  "  " +
    "step".padEnd(24) +
    "tier".padEnd(16) +
    "subTier".padEnd(18) +
    "verify_apass",
);
for (const r of results) {
  console.log(
    "  " +
      r.label.padEnd(24) +
      `${JSON.stringify(r.tier)} (${r.tierType})`.padEnd(16) +
      `${JSON.stringify(r.subTier)} (${r.subTierType})`.padEnd(18) +
      `code ${r.verifyCode}`,
  );
}

const afterOverrides = results.filter((r) => r.label !== "baseline");
const subTierObeyed = afterOverrides.every((r) => r.label.endsWith(String(r.subTier)));
const tierHeld = results.every((r) => r.tier === results[0].tier);
const tierNumeric = results.map((r) => Number(r.tier));
const tierEverUnsafe = tierNumeric.some((t) => !Number.isFinite(t) || t <= AUSDC_MIN_TIER);
const alwaysCode4 = results.every((r) => r.verifyCode === 4);

console.log("\nFINDINGS\n");
console.log(`  subTier changed as requested:      ${subTierObeyed ? "YES" : "NO"}`);
console.log(`  tier stayed ${JSON.stringify(results[0].tier)}:                 ${tierHeld ? "YES" : "NO"}`);
console.log(`  verify_apass code 4 at every grade: ${alwaysCode4 ? "YES" : "NO"}`);
console.log(`  tier ever <= min_tier (${AUSDC_MIN_TIER}):          ${tierEverUnsafe ? "YES - DANGER" : "NO"}`);

console.log("\nVERDICT\n");
if (!subTierObeyed) {
  console.log("  GATE 1: FAIL — the sandbox did not store the requested subTier.");
  console.log("  Our grade ladder cannot be published to A-Pass as designed.");
  process.exit(1);
} else if (tierEverUnsafe || !alwaysCode4) {
  console.log("  GATE 1: FAIL — a subTier downgrade dragged the credential below what");
  console.log("  aUSDC requires. A downgraded borrower would be unable to transfer aUSDC,");
  console.log("  and therefore unable to REPAY. Enforcement needs a redesign: keep the");
  console.log("  penalty off-chain in CreditLine, or stop publishing downgrades to A-Pass.");
  process.exit(1);
} else {
  console.log("  GATE 1: PASS — subTier tracks our credit grade while tier is unaffected,");
  console.log("  so a downgraded borrower can still transfer aUSDC and repay. The");
  console.log("  downgrade penalty is safe to publish to A-Pass.");
}
console.log("");
