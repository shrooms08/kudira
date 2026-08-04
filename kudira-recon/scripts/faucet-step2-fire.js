// Step 2: fire ONE institution-faucet request. Exactly one dispense.
// Plain JSON body over HTTP/2 (write-path discipline: the dispense is an on-chain
// transfer that can outlive the HTTP/1.1 idle window).
//
//   node scripts/faucet-step2-fire.js

import "../src/lib/tls-compat.js"; // must be first

import { loadEnv } from "../load-env.js";
import { h2Post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID) {
  console.error("Missing CLEANVERSE_API_ID in .env");
  process.exit(1);
}

const body = {
  chain: "base",
  symbol: "usdc",
  depositAddress: "0x6e100fA79b20fe7B4A04d6b7E2B6BA7d9f2e602c",
  amount: "500",
};

console.log(`firing ONE /faucet request @ ${new Date().toISOString()}`);
console.log("  body:", JSON.stringify(body));

const res = await h2Post("/faucet", body, { "api-id": API_ID }, 90_000);

console.log("\nresponse:");
if (res.error) {
  console.log(`  transport error: ${res.error}  (on-chain effect must be judged from balances)`);
} else {
  console.log(`  http ${res.httpStatus}`);
  console.log(JSON.stringify(res.body, null, 2));
  const tx = res.body?.data?.txHash ?? res.body?.data?.tx_hash ?? res.body?.data?.hash;
  if (tx) console.log(`\n  txHash: ${tx}`);
}
