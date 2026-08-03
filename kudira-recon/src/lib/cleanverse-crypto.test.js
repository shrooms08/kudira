// Local round-trip test for the AES helper. No network, no real identity data.
// Run: node src/lib/cleanverse-crypto.test.js
//
// Uses a throwaway 32-byte key set only in-process, so it needs no .env and
// never touches the real CLEANVERSE_API_KEY.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Set a synthetic key BEFORE importing the module under test reads it. getKey()
// reads process.env at call time, so setting it here is sufficient.
process.env.CLEANVERSE_API_KEY = randomBytes(32).toString("base64");

const { encrypt, decrypt } = await import("./cleanverse-crypto.js");

// A sample shaped like a real body but with obviously fake values.
const sample = {
  customerId: "ROUNDTRIPTEST01",
  subTier: 10,
  override: false,
  wallet: { address: "0x000000000000000000000000000000000000dEaD", chain: "monad" },
  nested: { list: [1, 2, 3], flag: true, note: "unicode ✓ ñ 漢" },
};

const b64 = encrypt(sample);
assert.equal(typeof b64, "string", "encrypt must return a string");
assert.match(b64, /^[A-Za-z0-9+/]+={0,2}$/, "output must be Base64");

const roundTripped = decrypt(b64);
assert.deepEqual(roundTripped, sample, "decrypt(encrypt(x)) must equal x");

// Determinism: fixed key + fixed IV => identical ciphertext for identical input.
assert.equal(encrypt(sample), b64, "same input must produce same ciphertext");

// Ciphertext length is a whole number of 16-byte blocks (CBC + PKCS#7).
assert.equal(Buffer.from(b64, "base64").length % 16, 0, "ciphertext must be block-aligned");

console.log("cleanverse-crypto round-trip: PASS");
console.log(`  sample keys: ${Object.keys(sample).join(", ")}`);
console.log(`  ciphertext: ${Buffer.from(b64, "base64").length} bytes (block-aligned), Base64 ${b64.length} chars`);
