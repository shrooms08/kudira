// Steps 6-7 of the ARCHITECTURE 8.1 sequence: validator/grant, then
// validator/register, then confirm with validator/is_register.
//
// Both grant and register are ENCRYPTED write endpoints (a plain-JSON body
// returns "Forbidden.Data decryption failed") and both require an EIP-191
// owner_signature over lowercase(chain) + lowercase(address), verified against
// the pool's on-chain owner().
//
// IMPORTANT: the signature check runs BEFORE field validation — an empty
// encrypted body still returns "Invalid contract owner signature." That means a
// wrong field name and a wrong signature are indistinguishable from the
// response, so this script makes ONE attempt at each step and stops on failure
// rather than retry-looping.
//
// Usage: node scripts/validator-register.js <poolAddress> <ownerSignature>

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

const POOL = process.argv[2];
const SIGNATURE = process.argv[3];
if (!POOL || !/^0x[0-9a-fA-F]{40}$/.test(POOL) || !SIGNATURE || !/^0x[0-9a-fA-F]{130}$/.test(SIGNATURE)) {
  console.error("Usage: node scripts/validator-register.js <poolAddress> <ownerSignature>");
  process.exit(1);
}

const CHAIN = "base";

// Initial rule. Mirrors aUSDC's own rule (min_tier 5, strictly greater), which
// is the weakest meaningful policy: it can never reject someone who could
// otherwise hold the token we settle in. min_sub_tier stays 0 because Kudira's
// credit grade is enforced on-chain in CreditLine, not by the validator.
//
// Keep this in sync with KudiraPool.setRule() or the on-chain mirror drifts.
const RULE = {
  allowed_group: "",
  allowed_sub_group: "",
  min_tier: 5,
  min_sub_tier: 0,
  is_black_list: false,
  countries: [],
};

const api = (path, body) => post(`${BASE_URL}${path}`, body, { "api-id": API_ID });
const indent = (o) => JSON.stringify(o, null, 2).split("\n").map((l) => "    " + l).join("\n");

const SIGNATURE_ERROR = "invalid contract owner signature";
function isSignatureFailure(body) {
  return String(body?.message ?? "").toLowerCase().includes(SIGNATURE_ERROR);
}

function stopOnSignatureFailure(step, res) {
  console.log("\n" + "=".repeat(70));
  console.log(`STOPPED at ${step}. Verbatim response:\n`);
  console.log(indent(res.body));
  console.log("\nNot retrying. The signature check runs before field validation, so this");
  console.log("means either the payload shape or the signed message is structurally wrong.");
  console.log(`Message that must have been signed:  ${CHAIN.toLowerCase()}${POOL.toLowerCase()}`);
  console.log("=".repeat(70) + "\n");
  process.exit(1);
}

console.log("\nValidator registration (ARCHITECTURE 8.1 steps 6-7)");
console.log(`  chain:  ${CHAIN}`);
console.log(`  pool:   ${POOL}`);
console.log(`  signed: ${CHAIN.toLowerCase()}${POOL.toLowerCase()}`);

// --- Baseline -----------------------------------------------------------------
const before = await api("/validator/is_register", { chain: CHAIN, contract_address: POOL });
console.log(`\n  is_register (before): registered=${before.body?.data?.registered}`);

// --- Step 6a: grant -----------------------------------------------------------
// NOTE: grant and register use DIFFERENT key names for the address.
// grant takes `address` (the account receiving REGISTER_ROLE); register takes
// `contract_address`. Sending the wrong one returns "Invalid contract owner
// signature." — the signature check runs first, so a field-name mistake is
// indistinguishable from a bad signature. That cost us a full cycle.
console.log("\n=== validator/grant ===");
const grantBody = { chain: CHAIN, address: POOL, owner_signature: SIGNATURE };
const grant = await h2Post("/validator/grant", { data: encrypt(grantBody) }, { "api-id": API_ID });
if (grant.error) {
  console.error(`  ✖ transport error: ${grant.error}`);
  process.exit(1);
}
console.log(`  http ${grant.httpStatus}`);
console.log(indent(grant.body));
if (isSignatureFailure(grant.body)) stopOnSignatureFailure("validator/grant", grant);
if (grant.body?.code !== "0000") {
  console.error(`\n  ✖ grant failed with code ${grant.body?.code}: ${grant.body?.message}`);
  process.exit(1);
}
console.log("  ✓ REGISTER_ROLE granted");

// Serialize: let the grant confirm before the next mutation.
await new Promise((r) => setTimeout(r, 8000));

// --- Step 6b: register --------------------------------------------------------
console.log("\n=== validator/register ===");
console.log(`  initial rule: ${JSON.stringify(RULE)}`);
// `rule` is a NESTED object here, not flattened into the body.
const registerBody = { chain: CHAIN, contract_address: POOL, rule: RULE, owner_signature: SIGNATURE };
const reg = await h2Post("/validator/register", { data: encrypt(registerBody) }, { "api-id": API_ID });
if (reg.error) {
  console.error(`  ✖ transport error: ${reg.error}`);
  process.exit(1);
}
console.log(`  http ${reg.httpStatus}`);
console.log(indent(reg.body));
if (isSignatureFailure(reg.body)) stopOnSignatureFailure("validator/register", reg);
if (reg.body?.code !== "0000") {
  console.error(`\n  ✖ register failed with code ${reg.body?.code}: ${reg.body?.message}`);
  process.exit(1);
}
console.log("  ✓ pool registered");

// --- Step 7: confirm ----------------------------------------------------------
console.log("\n=== validator/is_register (confirm) ===");
let registered = false;
for (let i = 1; i <= 10; i++) {
  const r = await api("/validator/is_register", { chain: CHAIN, contract_address: POOL });
  registered = r.body?.data?.registered === true;
  console.log(`  attempt ${i}: registered=${r.body?.data?.registered}`);
  if (registered) break;
  await new Promise((res) => setTimeout(res, 6000));
}

console.log("\n" + "=".repeat(70));
if (registered) {
  console.log("VALIDATOR REGISTRATION: CONFIRMED — is_register returns true.");
  const rules = await api("/atoken/rules", { chain: CHAIN, atoken_address: POOL });
  if (rules.body?.code === "0000") {
    console.log("\n  Registered rules for the pool:");
    console.log(indent(rules.body?.data));
  }
  process.exit(0);
}
console.log("VALIDATOR REGISTRATION: register accepted but is_register still false.");
console.log("Reporting as-is rather than assuming. Re-check before relying on it.");
process.exit(1);
