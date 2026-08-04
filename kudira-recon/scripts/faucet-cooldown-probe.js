// Characterize the /faucet cap + cooldown: fire several rapid calls into the
// POOL's deposit wallet (keeps the treasury at exactly 5 for the TR test) and
// record code/amount/message + timing for each.
//
//   node scripts/faucet-cooldown-probe.js

import "../src/lib/tls-compat.js";

import { loadEnv } from "../load-env.js";
import { h2Post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));
const API_ID = process.env.CLEANVERSE_API_ID;

const POOL_DEPOSIT = "0x6e100fA79b20fe7B4A04d6b7E2B6BA7d9f2e602c";
const N = 4;

const started = Date.now();
for (let i = 1; i <= N; i++) {
  const t0 = Date.now();
  const res = await h2Post(
    "/faucet",
    { chain: "base", symbol: "usdc", depositAddress: POOL_DEPOSIT, amount: "500" },
    { "api-id": API_ID },
    90_000,
  );
  const dt = ((Date.now() - started) / 1000).toFixed(1);
  const d = res.body?.data;
  console.log(
    `  call ${i} @ +${dt}s  code=${res.body?.code ?? res.error} amount=${d?.amount ?? "-"} ` +
      `tx=${d?.tx_hash ?? "-"} message=${res.body?.message ?? "-"}`,
  );
}
