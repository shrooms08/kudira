// Cleanverse sandbox API — read-only recon.
// Probes endpoints to learn: which chains have a live A-Token, whether Monad
// is usable, and what access role our credentials appear to hold.
//
// Rules honoured here:
//   - Read-only. No product logic, no writes to any remote resource.
//   - Only two headers are sent: api-id and Content-Type. Nothing else.
//   - CLEANVERSE_API_KEY is the local AES key for encrypting write-endpoint
//     bodies. It is NOT an auth credential and is never read or sent here.
//   - The API returns HTTP 200 even on business failure; success == code "0000".
//   - Every call's full JSON body is printed regardless of outcome.

import "./src/lib/tls-compat.js"; // must be first: fixes the TLS handshake to the sandbox

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

// --- Load .env ----------------------------------------------------------------
// Prefer Node's built-in loader (requires 20.12+); fall back to a minimal
// manual parse so this runs on any Node 20+ (or earlier) without a dependency.
function loadEnv(url) {
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(url);
      return;
    } catch {
      // fall through to manual parse
    }
  }
  let text;
  try {
    text = readFileSync(url, "utf8");
  } catch {
    console.warn("! Could not read .env — relying on existing process env.");
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv(new URL("./.env", import.meta.url));

// Note: CLEANVERSE_API_KEY is intentionally NOT read here — recon uses only
// plain-JSON read endpoints, which need no encryption and no auth key.
const API_ID = process.env.CLEANVERSE_API_ID;

if (!API_ID) {
  console.error("Missing credentials. Set CLEANVERSE_API_ID in .env");
  process.exit(1);
}

const BASE_URL = "https://uatapi.cleanverse.com/api/cooperate";
const REQUEST_TIMEOUT_MS = 20_000;

// --- Probe definitions --------------------------------------------------------
const PROBES = [
  { name: "query_deposit_atoken_list [monad]",  path: "/query_deposit_atoken_list", body: { chain: "monad" } },
  { name: "query_deposit_atoken_list [base]",   path: "/query_deposit_atoken_list", body: { chain: "base" } },
  { name: "query_deposit_atoken_list [solana]", path: "/query_deposit_atoken_list", body: { chain: "solana" } },
  {
    name: "query_apass [base/dummy]",
    path: "/query_apass",
    body: { chain: "base", address: "0x0000000000000000000000000000000000000001" },
    expectError: true, // dummy address — a not-found error confirms reachability
  },
  { name: "query_apass_list", path: "/query_apass_list", body: { page: 1, pageSize: 5 } },
  {
    name: "validator/is_register [base/dummy]",
    path: "/validator/is_register",
    body: { chain: "base", contract_address: "0x0000000000000000000000000000000000000001" },
  },
  { name: "query_ramp_countries", path: "/query_ramp_countries", body: {} },
];

// --- Helpers ------------------------------------------------------------------

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

const PERMISSION_HINTS = [
  "permission", "unauthor", "forbidden", "not allow", "no access",
  "access den", "no right", "denied", "role", "not permitted",
];

// Decide whether we appear authorised to call an endpoint.
//   yes     -> success, or a plain business error (endpoint reachable, allowed)
//   no      -> permission/role/forbidden signal, or HTTP 401/403
//   unknown -> network error / no response
function authorisedVerdict({ ok, httpStatus, code, message }) {
  if (!ok) return "unknown";
  if (httpStatus === 401 || httpStatus === 403) return "no";
  if (code === "0000") return "yes";
  const haystack = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (PERMISSION_HINTS.some((h) => haystack.includes(h))) return "no";
  // Non-permission business error means the endpoint accepted our call.
  return "yes";
}

async function callProbe(probe) {
  const url = `${BASE_URL}${probe.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const record = {
    name: probe.name,
    path: probe.path,
    requestBody: probe.body,
    httpStatus: null,
    ok: false,
    code: null,
    message: null,
    body: null,
    error: null,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-id": API_ID,
      },
      body: JSON.stringify(probe.body),
      signal: controller.signal,
    });

    record.httpStatus = res.status;
    record.ok = true;

    const text = await res.text();
    try {
      record.body = JSON.parse(text);
    } catch {
      record.body = { _raw: text }; // non-JSON body — keep it visible
    }

    record.code = deepFind(record.body, ["code"]) ?? null;
    record.message =
      deepFind(record.body, ["message", "msg", "error", "errorMsg", "desc"]) ?? null;
  } catch (err) {
    record.error = err?.name === "AbortError" ? "timeout" : String(err?.message ?? err);
  } finally {
    clearTimeout(timer);
  }

  record.authorised = authorisedVerdict(record);
  return record;
}

// --- Run ----------------------------------------------------------------------

console.log(`\nCleanverse recon — ${BASE_URL}`);
console.log(`api-id: ${API_ID}\n`);

const results = [];
for (const probe of PROBES) {
  console.log("─".repeat(72));
  console.log(`▶ ${probe.name}  POST ${probe.path}`);
  console.log(`  request: ${JSON.stringify(probe.body)}`);
  const record = await callProbe(probe);

  if (record.error) {
    console.log(`  ✖ transport error: ${record.error}`);
  } else {
    console.log(`  http ${record.httpStatus}  code=${record.code}  authorised=${record.authorised}`);
    console.log("  body:");
    console.log(
      JSON.stringify(record.body, null, 2)
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    );
  }
  results.push(record);
}

// --- Persist ------------------------------------------------------------------
const outPath = new URL("./recon-results.json", import.meta.url);
await writeFile(
  outPath,
  JSON.stringify(
    { base: BASE_URL, apiId: API_ID, ranAt: new Date().toISOString(), results },
    null,
    2,
  ),
);
console.log("\n" + "─".repeat(72));
console.log(`Wrote results to recon-results.json`);

// --- Summary table ------------------------------------------------------------
function truncate(s, n) {
  s = (s ?? "").toString().replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const rows = results.map((r) => ({
  endpoint: truncate(r.name, 34),
  http: r.error ? "ERR" : String(r.httpStatus ?? "-"),
  code: truncate(r.code ?? (r.error ? r.error : "-"), 8),
  message: truncate(r.message ?? r.error ?? "", 32),
  auth: r.authorised,
}));

const w = {
  endpoint: Math.max(8, ...rows.map((r) => r.endpoint.length)),
  http: 6,
  code: Math.max(4, ...rows.map((r) => r.code.length)),
  message: Math.max(7, ...rows.map((r) => r.message.length)),
  auth: 5,
};
const pad = (s, n) => s.padEnd(n);

console.log("\nSUMMARY");
console.log(
  [pad("endpoint", w.endpoint), pad("http", w.http), pad("code", w.code), pad("message", w.message), "auth"].join(" | "),
);
console.log(
  [pad("", w.endpoint).replace(/ /g, "-"), pad("", w.http).replace(/ /g, "-"), pad("", w.code).replace(/ /g, "-"), pad("", w.message).replace(/ /g, "-"), pad("", w.auth).replace(/ /g, "-")].join("-+-"),
);
for (const r of rows) {
  console.log(
    [pad(r.endpoint, w.endpoint), pad(r.http, w.http), pad(r.code, w.code), pad(r.message, w.message), r.auth].join(" | "),
  );
}

// --- Plain-English conclusion -------------------------------------------------
const byPath = (path, chain) =>
  results.find(
    (r) => r.path === path && (chain ? r.requestBody?.chain === chain : true),
  );

const chainStatus = (chain) => {
  const r = byPath("/query_deposit_atoken_list", chain);
  if (!r || r.error) return { live: false, reason: r?.error ?? "no response" };
  if (r.code !== "0000") return { live: false, reason: `code ${r.code}: ${r.message ?? "no data"}` };
  const accesscore = deepFind(r.body, ["accesscore_address", "accesscoreAddress"]);
  const apass = deepFind(r.body, ["apass_address", "apassAddress"]);
  const hasData = accesscore || apass || (Array.isArray(deepFind(r.body, ["data", "list"])) && deepFind(r.body, ["data", "list"]).length > 0);
  return { live: Boolean(hasData), accesscore, apass, reason: hasData ? "A-Token present" : "success but no A-Token in payload" };
};

const monad = chainStatus("monad");
const base = chainStatus("base");
const solana = chainStatus("solana");

const apassList = byPath("/query_apass_list");
const validator = byPath("/validator/is_register");
const rampCountries = byPath("/query_ramp_countries");

let role;
if (validator?.authorised === "yes") {
  role = "Issue Member (validator module reachable — Issue-only scope)";
} else if (apassList?.authorised === "yes") {
  role = "Gateway Member (can list A-Pass records; validator not permitted)";
} else if (rampCountries?.authorised === "yes") {
  role = "Service Partner (baseline endpoints only; no A-Pass list / validator access)";
} else {
  role = "Unknown — even baseline auth did not succeed";
}

const fmtChain = (name, s) =>
  `  - ${name}: ${s.live ? "LIVE A-Token" : "no live A-Token"} (${s.reason})` +
  (s.accesscore ? `\n      accesscore_address: ${s.accesscore}` : "") +
  (s.apass ? `\n      apass_address:      ${s.apass}` : "");

console.log("\nCONCLUSION");
console.log("• Chains with a live A-Token:");
console.log(fmtChain("monad", monad));
console.log(fmtChain("base", base));
console.log(fmtChain("solana", solana));
console.log(`\n• Is Monad usable? ${monad.live ? "YES — a live A-Token exists on monad." : "NO — no live A-Token found on monad (" + monad.reason + ")."}`);
console.log(`\n• Apparent access role: ${role}`);
console.log(
  `    query_apass_list  -> authorised=${apassList?.authorised ?? "n/a"} (code ${apassList?.code ?? "-"})`,
);
console.log(
  `    validator/is_register -> authorised=${validator?.authorised ?? "n/a"} (code ${validator?.code ?? "-"})`,
);
console.log(
  `    query_ramp_countries  -> authorised=${rampCountries?.authorised ?? "n/a"} (code ${rampCountries?.code ?? "-"})`,
);
console.log("");
