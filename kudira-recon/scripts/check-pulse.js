// Pulse check on the Cleanverse mint pipelines — are base and monad landing
// records? Prints each chain's total and newest registeredAt stamps from
// query_apass_list, so recovery can be spotted without a full recon run.
//
// Read-only, plain JSON, no writes, no key material. Usage:
//   node scripts/check-pulse.js

import "../src/lib/tls-compat.js"; // must be first: fixes the TLS handshake to the sandbox

import { loadEnv } from "../load-env.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID) {
  console.error("Missing credentials. Set CLEANVERSE_API_ID in .env");
  process.exit(1);
}

const CHAINS = ["base", "monad"];
const URL_ = "https://uatapi.cleanverse.com/api/cooperate/query_apass_list";

async function pulse(chain) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-id": API_ID },
      body: JSON.stringify({ chain, page: 1, pageSize: 3 }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (body?.code !== "0000") {
      return { chain, error: `http ${res.status} code=${body?.code ?? "?"} message=${body?.message ?? "?"}` };
    }
    const { total, items = [] } = body.data ?? {};
    return { chain, total, stamps: items.map((i) => i.registeredAt) };
  } catch (err) {
    return { chain, error: err?.name === "AbortError" ? "timeout" : String(err?.cause?.code ?? err.message) };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`pulse @ ${new Date().toISOString()}\n`);
const results = await Promise.all(CHAINS.map(pulse));

for (const r of results) {
  console.log(`${r.chain}`);
  if (r.error) {
    console.log(`  ✖ ${r.error}\n`);
    continue;
  }
  const newest = r.stamps[0] ?? null;
  console.log(`  total:  ${r.total}`);
  console.log(`  newest: ${r.stamps.join(", ") || "(no records)"}`);
  if (newest) {
    // registeredAt carries no timezone marker and offsets differ per chain
    // (monad stamps have matched UTC; base has shown UTC+8), so age is computed
    // as-if-UTC and labelled as such — read it as an approximation.
    const ageMin = Math.round((Date.now() - Date.parse(`${newest}Z`)) / 60_000);
    if (ageMin < 0) {
      console.log(`  age:    stamp is ${-ageMin} min ahead of UTC (offset timezone) — treat as just minted`);
    } else {
      console.log(`  age:    ~${ageMin} min (as-if-UTC)`);
    }
    console.log(ageMin <= 30 ? "  → pipeline looks ALIVE (minted within ~30 min)" : "  → no recent mint; pipeline likely stalled");
  }
  console.log("");
}

// --- aUSDC rule drift ---------------------------------------------------------
//
// aUSDC gates transfers on `min_tier`, and `min_sub_tier` is currently 0
// (unrestricted). If min_sub_tier ever moves off 0, a Kudira subTier downgrade
// could push a borrower below the token's threshold and stop them REPAYING —
// the exact failure Gate 1 ruled out. That safety result is only true while the
// rule holds, so poll it and shout if it moves.
const AUSDC = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";
const EXPECTED_MIN_TIER = 5;
const EXPECTED_MIN_SUB_TIER = 0;

const rulesRes = await fetch("https://uatapi.cleanverse.com/api/cooperate/atoken/rules", {
  method: "POST",
  headers: { "Content-Type": "application/json", "api-id": API_ID },
  // NOTE: this endpoint takes `atoken_address`; /verify_apass takes `atoken`.
  body: JSON.stringify({ chain: "base", atoken_address: AUSDC }),
}).then((r) => r.json()).catch((e) => ({ _error: String(e?.cause?.code ?? e.message) }));

console.log("aUSDC rules (base)");
if (rulesRes?._error || rulesRes?.code !== "0000") {
  console.log(`  ✖ could not read rules: ${rulesRes?._error ?? rulesRes?.message ?? "unknown"}\n`);
} else {
  const rules = rulesRes.data?.rules ?? [];
  if (rules.length === 0) {
    console.log("  ✖ NO RULES RETURNED — cannot confirm the transfer gate. Investigate.\n");
  }
  for (const [i, rule] of rules.entries()) {
    console.log(
      `  [${i}] min_tier=${rule.min_tier} min_sub_tier=${rule.min_sub_tier} ` +
        `is_black_list=${rule.is_black_list} countries=${JSON.stringify(rule.countries)} ` +
        `allowed_group=${JSON.stringify(rule.allowed_group)}`,
    );

    const drifted = [];
    if (rule.min_sub_tier !== EXPECTED_MIN_SUB_TIER) {
      drifted.push(`min_sub_tier moved ${EXPECTED_MIN_SUB_TIER} -> ${rule.min_sub_tier}`);
    }
    if (rule.min_tier !== EXPECTED_MIN_TIER) {
      drifted.push(`min_tier moved ${EXPECTED_MIN_TIER} -> ${rule.min_tier}`);
    }
    if (rule.is_black_list) drifted.push("is_black_list is now TRUE");
    if ((rule.countries ?? []).length > 0) drifted.push(`country restriction added: ${JSON.stringify(rule.countries)}`);

    if (drifted.length) {
      console.log("");
      console.log("  ####################################################################");
      console.log("  # ALERT: aUSDC TRANSFER RULE CHANGED                                #");
      for (const d of drifted) console.log(`  #   - ${d}`);
      console.log("  #                                                                  #");
      console.log("  # If min_sub_tier is no longer 0, a Kudira downgrade can strand a   #");
      console.log("  # borrower below the token threshold and block their REPAYMENT.     #");
      console.log("  # Re-run Gate 1 before penalising anyone: gate1-override-tier.js    #");
      console.log("  ####################################################################");
    } else {
      console.log("  → unchanged (min_sub_tier still 0: downgrades cannot block repayment)");
    }
  }
  console.log("");
}
