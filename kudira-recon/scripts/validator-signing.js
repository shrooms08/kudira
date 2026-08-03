// Builds the exact EIP-191 message for validator/grant and validator/register,
// so it is never constructed by hand.
//
// Per ARCHITECTURE.md 3.3 the message is:
//     lowercase(chain) + lowercase(address)      no separator
// signed with personal_sign and verified by Cleanverse against the contract's
// on-chain owner(). BOTH endpoints use this same construction, so it is one
// string used twice, not two different strings.
//
// Usage:
//   node scripts/validator-signing.js <poolAddress>
//   node scripts/validator-signing.js <poolAddress> <signature>   # verify it
//
// The second form recovers the signer locally and checks it against the pool's
// on-chain owner(), so a bad signature is caught here rather than as an opaque
// rejection from the sandbox.

import "../src/lib/tls-compat.js"; // must be first

import { execFile } from "node:child_process";

const POOL = process.argv[2];
const SIGNATURE = process.argv[3];
const CHAIN = "base";
const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

if (!POOL || !/^0x[0-9a-fA-F]{40}$/.test(POOL)) {
  console.error("Usage: node scripts/validator-signing.js <poolAddress> [signature]");
  process.exit(1);
}

const message = CHAIN.toLowerCase() + POOL.toLowerCase();

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      resolve(err ? { error: String(stderr || err.message).trim() } : { out: stdout.trim() });
    });
  });
}

console.log("\nValidator signing material");
console.log(`  chain:   ${CHAIN}`);
console.log(`  pool:    ${POOL}`);

// Confirm the pool is real and read its owner: the signature must recover to it.
const code = await run("cast", ["code", POOL, "--rpc-url", RPC]);
const hasCode = !code.error && code.out && code.out !== "0x";
console.log(`  code:    ${hasCode ? `${(code.out.length - 2) / 2} bytes` : "NONE - not a contract yet"}`);

let owner = null;
if (hasCode) {
  const o = await run("cast", ["call", POOL, "owner()(address)", "--rpc-url", RPC]);
  owner = o.error ? null : o.out;
  console.log(`  owner(): ${owner ?? `unreadable (${o.error})`}`);
}

console.log("\nMESSAGE TO SIGN (identical for validator/grant and validator/register):");
console.log("\n    " + message + "\n");
console.log(`  length: ${message.length} chars, no separator, all lowercase`);

console.log("\nSign it with:");
console.log(`\n    cast wallet sign --account kudira-deployer "${message}"\n`);
console.log("  (the message starts with \"base\", not 0x, so cast signs it as a UTF-8");
console.log("   string via personal_sign - which is what EIP-191 requires here)");

if (SIGNATURE) {
  console.log("\n--- verifying the supplied signature ---");
  const rec = await run("cast", ["wallet", "verify", "--address", owner ?? POOL, message, SIGNATURE]);
  if (rec.error) {
    console.log(`  ✖ verification FAILED: ${rec.error}`);
    console.log("    Do not send this to Cleanverse - it will be rejected against owner().");
    process.exit(1);
  }
  console.log(`  ✓ signature recovers to ${owner} (the pool's on-chain owner)`);
  console.log("\n  Ready to send as owner_signature in validator/grant and validator/register.");
}
console.log("");
