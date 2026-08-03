// PHASE 2, GATE 0 — can Cleanverse issue an A-Pass to a CONTRACT address we control?
//
// Everything downstream depends on this. aUSDC gates transfers on both sides, so
// if a contract cannot hold a credential then KudiraPool cannot custody aUSDC at
// all and the settlement design has to change.
//
// Usage:  node scripts/gate0-probe-apass.js <probeContractAddress>
//
// Steps (all four must pass):
//   2. generate_apass to the probe contract  (HTTP/2, AES-encrypted body)
//   3. ownership proof via query_apass_list: exact customerId + chain + wallet
//   4. verify_apass against aUSDC, requiring data.code === 4
//   5. eth_call + stateDiff: simulate a real aUSDC transfer INTO the probe
//
// SYNTHETIC DATA ONLY. The sandbox is shared and readable by other teams.

import "../src/lib/tls-compat.js"; // must be first: fixes the TLS handshake to the sandbox

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

import { loadEnv } from "../load-env.js";
import { encrypt } from "../src/lib/cleanverse-crypto.js";
import { BASE_URL, h2Post, post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID || !process.env.CLEANVERSE_API_KEY) {
  console.error("Missing credentials. Set CLEANVERSE_API_ID and CLEANVERSE_API_KEY in .env");
  process.exit(1);
}

const PROBE = process.argv[2];
if (!PROBE || !/^0x[0-9a-fA-F]{40}$/.test(PROBE)) {
  console.error("Usage: node scripts/gate0-probe-apass.js <probeContractAddress>");
  process.exit(1);
}

const CHAIN = "base";
const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const AUSDC = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";
/// A wallet already proven to hold a credential (prove-aes cvRecordId 851).
const CREDENTIALED_EOA = "0x1e3991622470bb41dd8949f5da03496c6f8ee902";
/// OZ v5 ERC20 ERC-7201 namespace; _balances is the first field.
const ERC20_STORAGE_LOCATION = "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00";

const api = (path, body) => post(`${BASE_URL}${path}`, body, { "api-id": API_ID });
const indent = (o) => JSON.stringify(o, null, 2).split("\n").map((l) => "    " + l).join("\n");
const pad32 = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomAlnum(n) {
  const b = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALNUM[b[i] % ALNUM.length];
  return out;
}

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`\n  ✖ FAIL: ${msg}`);
};

// --- 0. Confirm the probe really is a contract --------------------------------

console.log("\nPHASE 2 GATE 0 — can a CONTRACT we control hold an A-Pass?");
console.log(`  probe:  ${PROBE}`);
console.log(`  chain:  ${CHAIN}  rpc: ${RPC}\n`);

const codeRes = await post(RPC, { jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [PROBE, "latest"] });
const codeLen = ((codeRes.body?.result ?? "0x").length - 2) / 2;
console.log(`  eth_getCode(probe): ${codeLen} bytes ${codeLen > 0 ? "(is a contract ✓)" : "(NOT a contract)"}`);
if (codeLen === 0) {
  fail("the probe address has no bytecode — deploy it first, or the gate proves nothing");
  process.exit(1);
}

// --- 2. Issue the A-Pass ------------------------------------------------------

const customerId = "KUDIRAPROBE" + randomAlnum(12);
const expirationTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
const requestObject = {
  customerId,
  expirationTime,
  wallet: { address: PROBE, chain: CHAIN },
  identityDataList: [
    { idType: "PASSPORT", fullName: "Test Entity", idNumber: "TESTONLY0002", issuingCountryISO2: "SG" },
  ],
  subTier: 80,
  override: false,
};

console.log("\n=== 2. generate_apass -> contract address (HTTP/2, encrypted) ===");
console.log(`  customerId:     ${customerId} (len ${customerId.length})`);
console.log(`  expirationTime: ${expirationTime} (${new Date(expirationTime * 1000).toISOString()})`);
console.log("  identityDataList: [1 synthetic PASSPORT record — redacted]");
console.log(`  subTier:        ${requestObject.subTier}`);

// Pre-check: the probe must not already have a record, or ownership is unprovable.
const pre = await api("/query_apass", { chain: CHAIN, address: PROBE });
console.log(`  pre-check:      code ${pre.body?.data?.code ?? pre.body?.code} (expect 0002 = not found)`);
if (pre.body?.code === "0000") {
  fail("the probe address already has an A-Pass — cannot attribute a new one to us");
  process.exit(1);
}

const gen = await h2Post("/generate_apass", { data: encrypt(requestObject) }, { "api-id": API_ID });
if (gen.error) {
  console.log(`  (no HTTP response: ${gen.error}) — read-back will decide`);
} else {
  console.log(`  http ${gen.httpStatus}`);
  console.log(indent(gen.body));
  const msg = JSON.stringify(gen.body ?? "").toLowerCase();
  if (gen.httpStatus === 403 || msg.includes("decrypt")) {
    fail(`write rejected: ${gen.body?.message ?? gen.httpStatus}`);
    process.exit(2);
  }
}

// --- 3. Ownership proof -------------------------------------------------------

console.log("\n=== 3. Ownership proof via query_apass_list ===");
let record = null;
for (let attempt = 1; attempt <= 10 && !record; attempt++) {
  for (let page = 1; page <= 3 && !record; page++) {
    const r = await api("/query_apass_list", { chain: CHAIN, page, pageSize: 50 });
    const items = r.body?.data?.items ?? [];
    record = items.find((i) => i.customerId === customerId) ?? null;
  }
  if (!record) {
    console.log(`  attempt ${attempt}: not indexed yet`);
    await new Promise((res) => setTimeout(res, 6000));
  }
}

if (!record) {
  fail("no record with our exact customerId appeared — the write did not land");
} else {
  console.log(indent(record));
  const checks = {
    "customerId matches exactly": record.customerId === customerId,
    'chain === "base"': record.chain === CHAIN,
    "wallet matches the probe contract":
      (record.walletAddress ?? "").toLowerCase() === PROBE.toLowerCase(),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
  if (!Object.values(checks).every(Boolean)) fail("ownership checks did not all pass");

  console.log(
    `  tier=${JSON.stringify(record.tier)} (${typeof record.tier})  ` +
      `subTier=${JSON.stringify(record.subTier)} (${typeof record.subTier})`,
  );
}

// --- 4. verify_apass against aUSDC -------------------------------------------

console.log("\n=== 4. verify_apass against aUSDC (require data.code === 4) ===");
// Parameter trap: /verify_apass takes `atoken`, while /atoken/rules takes `atoken_address`.
const ver = await api("/verify_apass", { chain: CHAIN, atoken: AUSDC, address: PROBE });
console.log(indent(ver.body));
const verCode = ver.body?.code === "0000" ? ver.body?.data?.code : null;
console.log(`  -> data.code = ${verCode ?? "NO VERDICT"}`);
if (verCode !== 4) fail(`verify_apass returned ${verCode ?? "no verdict"}, required 4`);

// --- 5. Prove it moves money --------------------------------------------------

console.log("\n=== 5. eth_call + stateDiff — simulate a real aUSDC transfer into the probe ===");

function castKeccak(hex) {
  return new Promise((resolve) => {
    execFile("cast", ["keccak", hex], (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

const slot = await castKeccak("0x" + pad32(CREDENTIALED_EOA) + ERC20_STORAGE_LOCATION.slice(2));
if (!slot) {
  fail("`cast` not on PATH — cannot derive the balance slot for the simulation");
} else {
  const override = {
    [AUSDC]: { stateDiff: { [slot]: "0x" + (10n ** 6n).toString(16).padStart(64, "0") } },
  };
  const data = "0xa9059cbb" + pad32(PROBE) + (1_000_000n).toString(16).padStart(64, "0");
  const sim = await post(RPC, {
    jsonrpc: "2.0",
    id: 2,
    method: "eth_call",
    params: [{ from: CREDENTIALED_EOA, to: AUSDC, data }, "latest", override],
  });

  if (sim.body?.error) {
    const d = sim.body.error.data ?? "";
    const offender = d.length >= 74 ? "0x" + d.slice(-40) : "(unknown)";
    console.log(`  REVERTED ${d.slice(0, 10)} naming ${offender}`);
    fail("aUSDC refuses to transfer into the probe contract");
  } else if (sim.body?.result) {
    // A truncated print would hide `false`. ERC20.transfer returning false is a
    // silent failure, so assert the full word is exactly 1.
    const returnedTrue = BigInt(sim.body.result) === 1n;
    console.log(`  transfer 1 aUSDC -> probe: ${returnedTrue ? "SUCCEEDS" : "returned FALSE"}`);
    console.log(`  full return value: ${sim.body.result}`);
    if (!returnedTrue) fail("transfer did not revert but returned false");
  } else {
    fail(`unexpected simulation response: ${JSON.stringify(sim.body ?? sim.error)}`);
  }
}

// --- Verdict ------------------------------------------------------------------

console.log("\n" + "=".repeat(70));
if (failed) {
  console.log("GATE 0: FAIL — do NOT deploy KudiraPool.");
  console.log("A contract we control could not be credentialed end to end. The pool");
  console.log("cannot custody aUSDC under the current design; settlement needs a rethink.");
  process.exit(1);
}
console.log("GATE 0: PASS");
console.log("A contract address we control can hold an A-Pass, verifies at code 4 against");
console.log("aUSDC, and receives a real transfer. KudiraPool can custody aUSDC.");
console.log(`  probe:      ${PROBE}`);
console.log(`  customerId: ${customerId}`);
console.log(`  tier=${JSON.stringify(record?.tier)} (${typeof record?.tier})  subTier=${JSON.stringify(record?.subTier)} (${typeof record?.subTier})`);
console.log("");
