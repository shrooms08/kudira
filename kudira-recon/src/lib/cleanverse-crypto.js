// AES helper for Cleanverse write endpoints.
//
// The sandbox encrypts request bodies with AES-256-CBC:
//   - key: CLEANVERSE_API_KEY, base64-decoded to 32 raw bytes
//   - IV:  16 zero bytes (the API's fixed convention)
//   - padding: PKCS#7 (Node's default when autoPadding is on)
//   - the ciphertext is Base64 for transport
//
// Security: this module never logs the key, the IV, or any plaintext. Callers
// must not log the object they pass to encrypt() either — it may carry identity
// data. Errors here are deliberately generic so a stack trace can't leak bytes.

import { createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-cbc";
const IV = Buffer.alloc(16, 0); // 16 zero bytes, per the API convention

// Read and validate the key at call time (not import time) so a missing key is
// reported by the entrypoint that actually needs it, after .env is loaded.
function getKey() {
  const raw = process.env.CLEANVERSE_API_KEY;
  if (!raw) {
    throw new Error("CLEANVERSE_API_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    // Report the length, never the bytes.
    throw new Error(`CLEANVERSE_API_KEY must decode to 32 bytes for AES-256; got ${key.length}`);
  }
  return key;
}

// encrypt(plaintextObject) -> Base64 string
export function encrypt(plaintextObject) {
  const key = getKey();
  const plaintext = Buffer.from(JSON.stringify(plaintextObject), "utf8");
  const cipher = createCipheriv(ALGORITHM, key, IV); // autoPadding on = PKCS#7
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encrypted.toString("base64");
}

// decrypt(base64String) -> object
export function decrypt(base64String) {
  const key = getKey();
  const ciphertext = Buffer.from(base64String, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, IV);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}
