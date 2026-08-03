// Read-only investigation: does an address need an A-Pass to hold or receive
// aUSDC on Base?
//
// Our Foundry tests settle in an unrestricted mock ERC20. If the real aUSDC
// gates transfers on A-Pass standing, then KudiraPool and every merchant payout
// address need credentials of their own and that becomes part of the deploy
// sequence — a structural finding, not a detail.
//
// Three probes:
//   1. /atoken/rules   — what does the token actually require?
//   2. /verify_apass   — how do three different kinds of address score?
//   3. eth_call        — what does the token itself say on-chain?
//
// Read-only throughout: query endpoints and eth_call. No writes, no AES, no
// contract changes.

import "../src/lib/tls-compat.js"; // must be first: fixes the TLS handshake to the sandbox

import { randomBytes } from "node:crypto";

import { loadEnv } from "../load-env.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID) {
  console.error("Missing credentials. Set CLEANVERSE_API_ID in .env");
  process.exit(1);
}

const BASE_URL = "https://uatapi.cleanverse.com/api/cooperate";
const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const CHAIN = "base";
const REQUEST_TIMEOUT_MS = 20_000;

const AUSDC = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";
const ACCESSCORE = "0x8F118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC";

// A wallet proven to carry a credential: minted by prove-aes.js on base,
// cvRecordId 851, customerId KUDIRAEaebVAlqoVDfERvB, tier "50" subTier 10.
const PROVEN_WALLET = "0x1e3991622470bb41dd8949f5da03496c6f8ee902";
// Fresh random address — nobody has ever issued it anything.
const BARE_WALLET = "0x" + randomBytes(20).toString("hex");

const SUBJECTS = [
  { label: "proven A-Pass wallet (cvRecordId 851)", address: PROVEN_WALLET },
  { label: "freshly generated address (no credential)", address: BARE_WALLET },
  { label: "AccessCore contract (no A-Pass)", address: ACCESSCORE },
];

/// Documented result codes for /verify_apass.
const VERIFY_CODES = {
  1: "AToken not found",
  2: "no A-Pass",
  3: "A-Pass exists but cannot transfer",
  4: "valid — transfer allowed",
};

// --- Transport ----------------------------------------------------------------

async function post(url, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
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
    return { error: err?.name === "AbortError" ? "timeout" : String(err?.cause?.code ?? err.message) };
  } finally {
    clearTimeout(timer);
  }
}

const api = (path, body) => post(`${BASE_URL}${path}`, body, { "api-id": API_ID });

let rpcId = 0;
async function ethCall(to, data) {
  const res = await post(RPC, { jsonrpc: "2.0", id: ++rpcId, method: "eth_call", params: [{ to, data }, "latest"] });
  if (res.error) return { error: res.error };
  if (res.body?.error) return { error: `rpc ${res.body.error.code}: ${res.body.error.message}` };
  return { result: res.body?.result };
}

const indent = (obj) => JSON.stringify(obj, null, 2).split("\n").map((l) => "    " + l).join("\n");
const pad32 = (addr) => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const decodeUint = (hex) => (hex && hex !== "0x" ? BigInt(hex) : null);

// --- 1. Token rules -----------------------------------------------------------

console.log("\n=== 1. /atoken/rules — what does aUSDC require? ===");
console.log(`  chain=${CHAIN} atoken=${AUSDC}\n`);

const rules = await api("/atoken/rules", { chain: CHAIN, atoken_address: AUSDC });
if (rules.error) {
  console.log(`  transport error: ${rules.error}`);
} else {
  console.log(`  http ${rules.httpStatus}`);
  console.log(indent(rules.body));

  const list = rules.body?.data?.rules ?? rules.body?.data?.list ?? rules.body?.data;
  const asArray = Array.isArray(list) ? list : list ? [list] : [];
  if (asArray.length) {
    console.log("\n  Rules, field by field:");
    asArray.forEach((r, i) => {
      console.log(`    [${i}] min_tier=${JSON.stringify(r.min_tier)} (${typeof r.min_tier})`);
      console.log(`        min_sub_tier=${JSON.stringify(r.min_sub_tier)} (${typeof r.min_sub_tier})`);
      console.log(`        allowed_group=${JSON.stringify(r.allowed_group)}`);
      console.log(`        is_black_list=${JSON.stringify(r.is_black_list)}`);
      console.log(`        countries=${JSON.stringify(r.countries)}`);
    });
  } else {
    console.log("\n  No rules array found at data.rules / data.list — see raw body above.");
  }
}

// --- 2. verify_apass across three kinds of address -----------------------------

console.log("\n\n=== 2. /verify_apass — three kinds of address ===\n");

const verdicts = [];
for (const s of SUBJECTS) {
  // Parameter naming trap: /atoken/rules takes `atoken_address`, but
  // /verify_apass takes `atoken`. Sending the wrong one returns code 0002
  // "Invalid request parameters", which is easy to misread as a real verdict.
  const res = await api("/verify_apass", { chain: CHAIN, atoken: AUSDC, address: s.address });
  console.log(`  ${s.label}`);
  console.log(`  ${s.address}`);
  if (res.error) {
    console.log(`      transport error: ${res.error}\n`);
    verdicts.push({ ...s, code: null, error: res.error });
    continue;
  }
  console.log(indent(res.body));

  // Guard against reading a request-validation failure as a verdict: only an
  // envelope code of "0000" carries a meaningful data.code.
  const envelope = res.body?.code;
  const raw = res.body?.data?.code;
  const numeric = envelope === "0000" && typeof raw === "number" ? raw : null;
  if (numeric === null) {
    console.log(`      -> NO VERDICT (envelope code ${JSON.stringify(envelope)}: ${res.body?.message})\n`);
  } else {
    console.log(`      -> data.code = ${numeric}  (${VERIFY_CODES[numeric] ?? "undocumented"})\n`);
  }
  verdicts.push({ ...s, code: numeric, apiCode: envelope, message: res.body?.data?.message });
}

// --- 3. The token itself, on-chain --------------------------------------------

console.log("\n=== 3. eth_call against aUSDC on Base Sepolia ===");
console.log(`  rpc=${RPC}\n`);

const chainIdRes = await post(RPC, { jsonrpc: "2.0", id: 0, method: "eth_chainId", params: [] });
console.log(`  eth_chainId: ${chainIdRes.body?.result} (${Number.parseInt(chainIdRes.body?.result ?? "0", 16)})`);

const balProbes = [
  { label: "balanceOf(AccessCore)", data: "0x70a08231" + pad32(ACCESSCORE) },
  { label: "balanceOf(proven wallet)", data: "0x70a08231" + pad32(PROVEN_WALLET) },
  { label: "balanceOf(bare address)", data: "0x70a08231" + pad32(BARE_WALLET) },
  { label: "totalSupply()", data: "0x18160ddd" },
];
for (const p of balProbes) {
  const r = await ethCall(AUSDC, p.data);
  if (r.error) {
    console.log(`  ${p.label.padEnd(26)} ✖ ${r.error}`);
  } else {
    const v = decodeUint(r.result);
    console.log(`  ${p.label.padEnd(26)} ${v === null ? "(empty)" : `${v} (raw units, 6dp => ${Number(v) / 1e6})`}`);
  }
}

console.log("\n  Optional/restriction getters (absent selectors just revert — that is informative):");
const optional = [
  { label: "paused()", data: "0x5c975abb" },
  { label: "owner()", data: "0x8da5cb5b" },
  { label: "accessCore()", data: "0x0a8b5fac" },
  { label: "validator()", data: "0x3a5381b5" },
  { label: "apass()", data: "0x8eecfafa" },
];
for (const p of optional) {
  const r = await ethCall(AUSDC, p.data);
  console.log(`  ${p.label.padEnd(26)} ${r.error ? `not present / reverted (${r.error})` : r.result}`);
}

// --- 4. Does the TOKEN enforce it on-chain, or is it only an API opinion? -----
//
// /verify_apass tells us what the compliance layer thinks. It does not prove the
// ERC20 reverts. This simulates real transfers with eth_call + stateDiff, giving
// a credentialed sender a balance and varying only the recipient. No state is
// written — eth_call is read-only.
//
// aUSDC is an OZ v5 upgradeable ERC20 (ERC-7201 namespaced storage), so the
// _balances mapping lives under the ERC20 namespace, not slot 0.
const ERC20_STORAGE_LOCATION = "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00";

console.log("\n\n=== 4. eth_call transfer simulation — does the token itself revert? ===\n");

const { keccak256 } = await import("node:crypto").then(async () => {
  // Node has no keccak256; derive the balance slot with a tiny local implementation.
  const { createHash } = await import("node:crypto");
  return { keccak256: null, createHash };
});

// The balance slot is keccak256(pad32(holder) ++ pad32(namespace)). Node ships
// SHA-3 but not Keccak-256, so shell out to `cast keccak` when available.
async function balanceSlot(holder) {
  const { execFile } = await import("node:child_process");
  const preimage = "0x" + pad32(holder) + ERC20_STORAGE_LOCATION.slice(2);
  return new Promise((resolve) => {
    execFile("cast", ["keccak", preimage], (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

async function simulateTransfer(from, to, slot, amount = 1_000_000n) {
  const data = "0xa9059cbb" + pad32(to) + amount.toString(16).padStart(64, "0");
  const override = {
    [AUSDC]: { stateDiff: { [slot]: "0x" + (10n ** 6n).toString(16).padStart(64, "0") } },
  };
  const res = await post(RPC, {
    jsonrpc: "2.0",
    id: ++rpcId,
    method: "eth_call",
    params: [{ from, to: AUSDC, data }, "latest", override],
  });
  if (res.error) return { error: res.error };
  if (res.body?.error) {
    const d = res.body.error.data ?? "";
    // Custom error payload is selector + one address argument: the party the
    // token objected to. Which party it names is the whole finding.
    const offender = d.length >= 74 ? "0x" + d.slice(-40) : null;
    return { reverted: true, selector: d.slice(0, 10) || null, offender };
  }
  return { ok: res.body?.result === "0x" + "1".padStart(64, "0") };
}

const senderSlot = await balanceSlot(PROVEN_WALLET);
if (!senderSlot) {
  console.log("  skipped: `cast` not on PATH (needed to derive the storage slot).");
} else {
  // Sanity: confirm the RPC actually honours stateDiff before trusting any result.
  const check = await post(RPC, {
    jsonrpc: "2.0",
    id: ++rpcId,
    method: "eth_call",
    params: [
      { to: AUSDC, data: "0x70a08231" + pad32(PROVEN_WALLET) },
      "latest",
      { [AUSDC]: { stateDiff: { [senderSlot]: "0x" + (10n ** 6n).toString(16).padStart(64, "0") } } },
    ],
  });
  const honoured = decodeUint(check.body?.result) === 10n ** 6n;
  console.log(`  RPC honours stateDiff overrides: ${honoured ? "yes" : "NO — results below are meaningless"}`);
  console.log(`  sender (credentialed, code 4): ${PROVEN_WALLET}\n`);

  const targets = [
    { label: "bare address (no A-Pass)", address: BARE_WALLET },
    { label: "AccessCore contract (no A-Pass)", address: ACCESSCORE },
    { label: "EOA holding an A-Pass", address: "0x1111111111111111111111111111111111111111" },
    { label: "CONTRACT holding an A-Pass", address: "0x4C637ce453caBe9B7B13A42eED9412f9eCf8a498" },
  ];
  for (const t of targets) {
    const r = await simulateTransfer(PROVEN_WALLET, t.address, senderSlot);
    const verdict = r.error
      ? `ERR ${r.error}`
      : r.reverted
        ? `REVERTED ${r.selector} naming ${r.offender}`
        : r.ok
          ? "SUCCEEDS"
          : "returned false";
    console.log(`  -> ${t.label.padEnd(34)} ${verdict}`);
  }
}

// --- Interpretation -----------------------------------------------------------

const byLabel = (frag) => verdicts.find((v) => v.label.includes(frag));
const proven = byLabel("proven");
const bare = byLabel("freshly");
const contract = byLabel("AccessCore");

console.log("\n\n=== INTERPRETATION ===\n");
console.log(`  proven A-Pass wallet -> code ${proven?.code ?? "?"} (${VERIFY_CODES[proven?.code] ?? "?"})`);
console.log(`  bare address         -> code ${bare?.code ?? "?"} (${VERIFY_CODES[bare?.code] ?? "?"})`);
console.log(`  contract address     -> code ${contract?.code ?? "?"} (${VERIFY_CODES[contract?.code] ?? "?"})`);

console.log("");
if (proven?.code === 4 && bare?.code !== 4) {
  console.log("  A credential is REQUIRED to receive aUSDC: our proven wallet is allowed (4)");
  console.log("  while an address with no A-Pass is not.");
  console.log("  => KudiraPool and every merchant payout address need their own A-Pass,");
  console.log("     issued as part of the deploy sequence, before any settlement can work.");
} else if (proven?.code === 4 && bare?.code === 4) {
  console.log("  Both the credentialled and the bare address return 4 (transfer allowed).");
  console.log("  => aUSDC does NOT gate receipt on holding an A-Pass under the current rules.");
  console.log("     Our unrestricted mock ERC20 is a faithful stand-in for settlement.");
  console.log("     Caveat: rules can be changed by the token owner; re-check before mainnet.");
} else {
  console.log("  Mixed or unexpected result — read the raw payloads above rather than trusting");
  console.log("  this summary. Not guessing.");
}
console.log("");
