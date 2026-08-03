// Two read-only checks that together answer: is the Monad registry entry real?
//
//   CHECK 1 — is Monad actually used?  Cleanverse /query_apass_list per chain,
//             comparing `total`. A chain nobody has issued an A-Pass on is a
//             configured chain, not a used one.
//   CHECK 2 — is the registry address right for this chain?  eth_call symbol(),
//             name(), decimals() on the aUSDC address, against Monad testnet.
//
// Rules honoured here:
//   - Read-only. POSTs are query endpoints; eth_call executes nothing on-chain.
//   - Only api-id and Content-Type are sent. CLEANVERSE_API_KEY is never read.
//   - The API returns HTTP 200 even on business failure; success == code "0000".

import "./src/lib/tls-compat.js"; // must be first: fixes the TLS handshake to the sandbox

import { loadEnv } from "./load-env.js";

loadEnv(new URL("./.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID) {
  console.error("Missing credentials. Set CLEANVERSE_API_ID in .env");
  process.exit(1);
}

const BASE_URL = "https://uatapi.cleanverse.com/api/cooperate";
const MONAD_RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const AUSDC = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";
const REQUEST_TIMEOUT_MS = 20_000;

const CHAINS = ["monad", "base", "solana"];

// symbol() and decimals() are what actually identify the token — a wrong address
// cannot coincidentally return both. name() is a human label, so a differing
// string is reported but does not by itself mean the address is wrong.
const CALLS = [
  { name: "symbol()", selector: "0x95d89b41", kind: "string", expected: "ausdc", identifying: true },
  { name: "name()", selector: "0x06fdde03", kind: "string", expected: "aUSDC", identifying: false },
  { name: "decimals()", selector: "0x313ce567", kind: "uint", expected: 6, identifying: true },
];

// --- Transport ----------------------------------------------------------------

// Plain global fetch. The TLS handshake to the sandbox is fixed by importing
// ./src/lib/tls-compat.js at the top of this file — no curl fallback needed.
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
    return { error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

let rpcId = 0;
async function ethCall(to, data) {
  const res = await post(MONAD_RPC, {
    jsonrpc: "2.0",
    id: ++rpcId,
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  if (res.error) return { error: res.error };
  if (res.body?.error) return { error: `rpc error ${res.body.error.code}: ${res.body.error.message}` };
  return { result: res.body?.result };
}

// Recursively find the first value for any of the given keys, anywhere in the tree.
function deepFind(obj, keys) {
  if (obj == null || typeof obj !== "object") return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k) && v != null && v !== "") return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = deepFind(v, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

// --- ABI decoding -------------------------------------------------------------

const hexToUtf8 = (hex) =>
  Buffer.from(hex.replace(/(00)+$/, ""), "hex").toString("utf8").replace(/\0/g, "");

// Handles both the ABI-standard dynamic string and the legacy bytes32 form
// some older tokens return for name()/symbol().
function decodeString(raw) {
  const hex = (raw ?? "").replace(/^0x/, "");
  if (!hex) return { error: 'empty return ("0x") — call reverted or not a contract' };
  if (hex.length === 64) return { value: hexToUtf8(hex), encoding: "bytes32" };
  if (hex.length < 128) return { error: `unexpected return length (${hex.length / 2} bytes)` };
  const offset = Number.parseInt(hex.slice(0, 64), 16) * 2;
  const len = Number.parseInt(hex.slice(offset, offset + 64), 16);
  if (!Number.isFinite(len)) return { error: "could not read string length" };
  return { value: hexToUtf8(hex.slice(offset + 64, offset + 64 + len * 2)), encoding: "string" };
}

function decodeUint(raw) {
  const hex = (raw ?? "").replace(/^0x/, "");
  if (!hex) return { error: 'empty return ("0x") — call reverted or not a contract' };
  return { value: Number.parseInt(hex, 16), encoding: "uint" };
}

// --- CHECK 1 ------------------------------------------------------------------

console.log("\nCHECK 1 — is Monad actually used?");
console.log(`POST ${BASE_URL}/query_apass_list  (api-id: ${API_ID})\n`);

const usage = [];
for (const chain of CHAINS) {
  const body = { chain, page: 1, pageSize: 5 };
  const res = await post(`${BASE_URL}/query_apass_list`, body, { "api-id": API_ID });

  const record = { chain, total: null, code: null, message: null, items: [], error: res.error ?? null };

  if (res.error) {
    console.log(`  ${chain.padEnd(7)} ✖ transport error: ${res.error}`);
  } else {
    record.code = deepFind(res.body, ["code"]) ?? null;
    record.message = deepFind(res.body, ["message", "msg", "error", "errorMsg", "desc"]) ?? null;
    const total = deepFind(res.body, ["total", "totalCount", "totalNum"]);
    record.total = total ?? null;
    const items = deepFind(res.body, ["items", "list", "records", "rows"]);
    record.items = Array.isArray(items) ? items : [];
    console.log(
      `  ${chain.padEnd(7)} http ${res.httpStatus}  code=${record.code}  total=${
        record.total ?? "(absent)"
      }  items=${record.items.length}` + (record.code !== "0000" ? `  message=${record.message ?? "-"}` : ""),
    );
  }
  usage.push(record);
}

const monadUsage = usage.find((u) => u.chain === "monad");
if (Number(monadUsage?.total) > 0 || monadUsage?.items?.length) {
  console.log("\n  monad items:");
  console.log(
    JSON.stringify(monadUsage.items, null, 2).split("\n").map((l) => "    " + l).join("\n"),
  );
} else {
  console.log("\n  monad items: none (total is 0 or absent) — nothing to print.");
}

// --- CHECK 2 ------------------------------------------------------------------

console.log(`\nCHECK 2 — are these the right contracts?`);
console.log(`eth_call ${AUSDC} @ ${MONAD_RPC}\n`);

const token = [];
for (const call of CALLS) {
  const res = await ethCall(AUSDC, call.selector);
  if (res.error) {
    token.push({ ...call, error: res.error, value: null, matches: false });
    console.log(`  ${call.name.padEnd(11)} ${call.selector}  ✖ ${res.error}`);
    continue;
  }
  const decoded = call.kind === "string" ? decodeString(res.result) : decodeUint(res.result);
  if (decoded.error) {
    token.push({ ...call, error: decoded.error, value: null, matches: false, raw: res.result });
    console.log(`  ${call.name.padEnd(11)} ${call.selector}  ✖ ${decoded.error}`);
    continue;
  }
  // Compare case-insensitively for strings: casing alone is not a wrong contract.
  const matches =
    call.kind === "string"
      ? String(decoded.value).toLowerCase() === String(call.expected).toLowerCase()
      : decoded.value === call.expected;
  token.push({ ...call, error: null, value: decoded.value, matches, raw: res.result });
  const flag = matches ? "✓ match" : call.identifying ? "✗ MISMATCH" : "≠ differs (label only)";
  console.log(
    `  ${call.name.padEnd(11)} ${call.selector}  -> ${JSON.stringify(decoded.value)}   expected ${JSON.stringify(
      call.expected,
    )}  ${flag}`,
  );
}

// --- Verdict ------------------------------------------------------------------

const monadTotal = Number(monadUsage?.total ?? 0);
const usageLine = usage
  .map((u) => `${u.chain}=${u.error ? "ERR" : (u.total ?? "absent")}`)
  .join("  ");
const anyUsage = usage.some((u) => Number(u.total) > 0);

const identifying = token.filter((t) => t.identifying);
const tokenOk = identifying.length > 0 && identifying.every((t) => t.matches);
const tokenFailed = token.some((t) => t.error);
const labelDiffs = token.filter((t) => !t.identifying && !t.error && !t.matches);
const tokenSummary = token
  .map((t) => `${t.name}=${t.error ? "ERR" : JSON.stringify(t.value)}`)
  .join("  ");

const line1 = monadTotal > 0
  ? `USED: Monad has ${monadTotal} A-Pass record(s) — the chain is live in the registry, not just configured.  [${usageLine}]`
  : anyUsage
    ? `UNUSED: Monad has 0 A-Pass records while another chain does — Monad is configured but nobody has issued on it.  [${usageLine}]`
    : `NO USAGE ANYWHERE: every chain reports 0/absent A-Pass records under these credentials — this tells us nothing about Monad specifically.  [${usageLine}]`;

const line2 = tokenFailed
  ? `TOKEN IDENTITY UNKNOWN: at least one ERC-20 call failed on Monad testnet — cannot confirm the registry address.  [${tokenSummary}]`
  : tokenOk
    ? `CORRECT CONTRACT: symbol and decimals match on Monad testnet` +
      (labelDiffs.length
        ? `; ${labelDiffs
            .map((t) => `${t.name} is ${JSON.stringify(t.value)} not ${JSON.stringify(t.expected)}`)
            .join(", ")} — a label difference, not a wrong address.  [${tokenSummary}]`
        : `.  [${tokenSummary}]`)
    : `WRONG CONTRACT FOR THIS CHAIN: identifying fields do not match.  [${tokenSummary}]`;

console.log("\nVERDICT");
console.log(`  1. ${line1}`);
console.log(`  2. ${line2}\n`);
