// Prove the AES key against the live Cleanverse sandbox — with ownership checks
// that make a false positive structurally impossible.
//
// Lesson learned the hard way: this sandbox is shared. Placeholder wallets like
// 0x1111…1111 already carry other teams' records, query_apass looks up by
// wallet and returns records regardless of which chain you ask for, and its
// response does NOT include customerId. So "the wallet reads back" proves
// nothing. A record only counts as OURS if every check below holds; anything
// less is reported as NOT OUR RECORD and the proof is treated as failed.
//
// SYNTHETIC DATA ONLY. Every value is fabricated fresh per run: random wallet,
// random customerId, fake passport. No real person, no real document.
//
// Exit codes: 0 proven · 1 no record landed / transport · 2 wrong key · 3 record
// found but failed ownership checks (NOT OUR RECORD).

import "../src/lib/tls-compat.js"; // must be first: fixes the TLS handshake to the sandbox

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http2 from "node:http2";

import { loadEnv } from "../load-env.js";
import { encrypt } from "../src/lib/cleanverse-crypto.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID || !process.env.CLEANVERSE_API_KEY) {
  console.error("Missing credentials. Set CLEANVERSE_API_ID and CLEANVERSE_API_KEY in .env");
  process.exit(1);
}

const ORIGIN = "https://uatapi.cleanverse.com";
const BASE_PATH = "/api/cooperate";

// Target chain: single CLI arg, default monad. One chain per run, used
// everywhere — the write, every read-back, and the ownership check.
const CHAIN = process.argv[2] ?? "monad";
if (!["monad", "base", "solana"].includes(CHAIN)) {
  console.error(`Unknown chain "${CHAIN}" — expected monad, base, or solana.`);
  process.exit(1);
}
const READ_TIMEOUT_MS = 15_000;
const GEN_TIMEOUT_MS = 60_000;
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 8_000;

// --- Fresh synthetic inputs (regenerated EVERY run, never hardcoded) ----------

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomAlnum(n) {
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALNUM[bytes[i] % ALNUM.length];
  return out;
}

// Fresh random wallet each run. Equivalent of ethers Wallet.createRandom for
// this purpose: nothing ever signs with it, so only the address matters — 20
// random bytes, unpredictable and collision-free. The pre-existence check below
// guards even the astronomical collision case.
const testWallet = "0x" + randomBytes(20).toString("hex");

const customerId = "KUDIRA" + randomAlnum(16);
assert.ok(customerId.length >= 12, "customerId must be at least 12 chars");
assert.match(customerId, /^[A-Za-z0-9]+$/, "customerId must be A-Za-z0-9 only");

const requestObject = {
  customerId,
  expirationTime: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // Unix seconds
  wallet: { address: testWallet, chain: CHAIN },
  identityDataList: [
    { idType: "PASSPORT", fullName: "Test Buyer", idNumber: "TESTONLY0001", issuingCountryISO2: "PH" },
  ],
  subTier: 10,
  override: false,
};

// --- Transports ---------------------------------------------------------------

// Reads: plain fetch (HTTP/1.1 is fine for fast query endpoints).
async function post(path, body, timeoutMs = READ_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ORIGIN}${BASE_PATH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-id": API_ID },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    try {
      return { httpStatus: res.status, body: JSON.parse(text) };
    } catch {
      return { httpStatus: res.status, body: { _raw: text } };
    }
  } catch (err) {
    return { error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

// Write: node:http2. The server closes HTTP/1.1 sockets at ~15s, aborting the
// on-chain mint before it commits; HTTP/2 connections are held open through it.
function h2Post(path, body, timeoutMs) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const client = http2.connect(ORIGIN);
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      try { client.close(); } catch { /* already closing */ }
      resolve(r);
    };
    client.on("error", (err) => done({ error: String(err?.code ?? err?.message ?? err) }));

    const req = client.request({
      ":method": "POST",
      ":path": `${BASE_PATH}${path}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      "api-id": API_ID,
    });
    req.setTimeout(timeoutMs, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      done({ error: "timeout" });
    });

    let status = null;
    let text = "";
    req.on("response", (h) => (status = h[":status"]));
    req.setEncoding("utf8");
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      try {
        done({ httpStatus: status, body: JSON.parse(text) });
      } catch {
        done({ httpStatus: status, body: { _raw: text } });
      }
    });
    req.on("error", (err) => done({ error: String(err?.code ?? err?.message ?? err) }));
    req.end(payload);
  });
}

// --- Lookups ------------------------------------------------------------------

const codeOf = (r) => (r?.body && typeof r.body === "object" ? r.body.code ?? null : null);

// query_apass: by-wallet lookup. Returns tier data but NO customerId — usable
// as an existence signal only, never as proof of ownership.
const queryApass = () => post("/query_apass", { chain: CHAIN, address: testWallet });

// query_apass_list: the only read that returns customerId + chain + wallet
// together — this is where ownership is actually verified.
async function findInList() {
  const r = await post("/query_apass_list", { chain: CHAIN, page: 1, pageSize: 50 });
  if (r.error || codeOf(r) !== "0000") return { error: r.error ?? `code ${codeOf(r)}` };
  const items = r.body?.data?.items ?? [];
  return {
    item:
      items.find(
        (i) =>
          (i.walletAddress ?? "").toLowerCase() === testWallet.toLowerCase() ||
          i.customerId === customerId,
      ) ?? null,
  };
}

const looksLikeDecryptFailure = (r) => {
  if (r.httpStatus === 403) return true;
  const hay = JSON.stringify(r.body ?? "").toLowerCase();
  return ["decrypt", "decryption", "padding", "cipher"].some((w) => hay.includes(w));
};

// --- Run ----------------------------------------------------------------------

console.log("\nProve AES key — fresh identities, strict ownership checks. SYNTHETIC DATA ONLY.");
console.log(`  chain:      ${CHAIN}`);
console.log(`  wallet:     ${testWallet}  (random, generated this run)`);
console.log(`  customerId: ${customerId}  (len ${customerId.length}, alnum-checked)`);

// STEP 1 — pre-existence check: the wallet must NOT have a record before we
// write. Without this, a pre-existing record could masquerade as our result.
const pre = await queryApass();
if (pre.error) {
  console.log(`\n✖ Pre-check transport error: ${pre.error} — cannot establish a clean baseline. Aborting.`);
  process.exit(1);
}
if (codeOf(pre) === "0000") {
  console.log("\n✖ Pre-check FAILED: this fresh wallet already has a record. Aborting — ownership");
  console.log("  could not be proven even if a record appears later. (Re-run for a new wallet.)");
  process.exit(3);
}
console.log(`  pre-check:  wallet has no record before the write (code ${codeOf(pre)}) ✓`);

const runStartedAt = Date.now();
console.log(`  runStartedAt: ${runStartedAt} (${new Date(runStartedAt).toISOString()})`);

// STEP 2 — the encrypted write.
const ciphertext = encrypt(requestObject);
console.log(`\n─ POST /generate_apass  { data: "<${ciphertext.length}-char Base64>" } over HTTP/2 ─`);
const gen = await h2Post("/generate_apass", { data: ciphertext }, GEN_TIMEOUT_MS);
if (gen.error) {
  console.log(`  (no HTTP response: ${gen.error}) — the mint can outlive the connection; read-back decides.`);
} else {
  console.log(`  http ${gen.httpStatus}`);
  console.log(JSON.stringify(gen.body, null, 2).split("\n").map((l) => "    " + l).join("\n"));
  if (looksLikeDecryptFailure(gen)) {
    console.log("\n✖ WRONG KEY — the sandbox could not decrypt our body (403 / decryption error). Stopping.");
    process.exit(2);
  }
}

// STEP 3 — poll for the record.
console.log(`\n─ read-back poll (query_apass + query_apass_list, chain=${CHAIN}) ─`);
let apass = null;
let listItem = null;
for (let i = 1; i <= POLL_ATTEMPTS; i++) {
  const [q, l] = await Promise.all([queryApass(), findInList()]);
  const qFound = codeOf(q) === "0000";
  if (qFound) apass = q;
  if (l.item) listItem = l.item;
  console.log(
    `  attempt ${String(i).padStart(2)}: query_apass=${q.error ?? codeOf(q)}  list-match=${
      l.item ? "FOUND" : l.error ?? "none"
    }`,
  );
  if (listItem) break; // ownership evidence in hand — stop polling
  if (i < POLL_ATTEMPTS) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

// STEP 4 — verdict. A record counts as OURS only if ALL checks pass.
console.log("\nVERDICT");
if (!apass && !listItem) {
  console.log("  ✖ PROOF FAILED for this run — no record landed within the poll window.");
  console.log("    No 403 'decryption failed' was returned, but per policy success is never inferred");
  console.log("    from anything except a record we verifiably created. Nothing landed; not proven.");
  process.exit(1);
}
if (!listItem) {
  console.log("  ✖ NOT OUR RECORD — query_apass returned a record for this wallet, but the list");
  console.log("    (the only source that exposes customerId) has no entry matching our customerId");
  console.log("    or wallet on monad. Ownership unverifiable → treated as failed.");
  process.exit(3);
}

const checks = {
  "customerId matches ours exactly": listItem.customerId === customerId,
  [`chain === "${CHAIN}"`]: listItem.chain === CHAIN,
  "record did not exist before the run (pre-check)": true, // asserted in STEP 1, else we aborted
  "wallet matches ours": (listItem.walletAddress ?? "").toLowerCase() === testWallet.toLowerCase(),
};
for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? "✓" : "✗"} ${name}`);

if (!Object.values(checks).every(Boolean)) {
  console.log("\n  ✖ NOT OUR RECORD — at least one ownership check failed. The proof is treated as");
  console.log("    FAILED. Never infer success from a record we did not create.");
  console.log(`    found: customerId=${JSON.stringify(listItem.customerId)} chain=${JSON.stringify(listItem.chain)} wallet=${JSON.stringify(listItem.walletAddress)}`);
  process.exit(3);
}

const tier = listItem.tier;
const subTier = listItem.subTier;
console.log("\n  ✓ AES KEY PROVEN for this run — the sandbox decrypted our body and persisted a record");
console.log("    carrying the exact customerId generated seconds ago; only our key could produce it.");
console.log(`    cvRecordId:   ${listItem.cvRecordId}`);
console.log(`    registeredAt: ${listItem.registeredAt} (runStartedAt ${new Date(runStartedAt).toISOString()})`);
console.log(`    tier=${JSON.stringify(tier)} (${typeof tier})  subTier=${JSON.stringify(subTier)} (${typeof subTier})`);
if (apass) {
  const d = apass.body?.data ?? {};
  console.log(`    query_apass view: tier=${JSON.stringify(d.tier)} (${typeof d.tier})  subTier=${JSON.stringify(d.subTier)} (${typeof d.subTier})`);
}
console.log("");
