// Step 4: does download_travel_rule now generate for the aUSDC conversion?
// Previously KUSDC settlements returned TR_001 (outside the indexed flow). aUSDC
// is inside it, so this is the proof-or-disproof. Read-only.
//
//   node scripts/faucet-step4-travelrule.js

import "../src/lib/tls-compat.js"; // must be first

import { loadEnv } from "../load-env.js";
import { BASE_URL, post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));

const API_ID = process.env.CLEANVERSE_API_ID;
if (!API_ID) {
  console.error("Missing CLEANVERSE_API_ID in .env");
  process.exit(1);
}

const api = (body) => post(`${BASE_URL}/download_travel_rule`, body, { "api-id": API_ID });

const POOL = "0x4a898781AFAd85BE7103126952BcBbFCCC24199e";
const DEPOSIT = "0x6e100fA79b20fe7B4A04d6b7E2B6BA7d9f2e602c";
const TX_AUSDC_MINT = "0xfaef29dcd245566b0041f18204156775c2818490e1703fca033366c83a1b2cff"; // aUSDC 0x0 -> pool
const TX_ORIGIN_DEPOSIT = "0xc04988ef4fe4774450a5f51d7a22a42dc57f6c836acb68c8793dc09981a5d8b5"; // origin faucet -> deposit

const cases = [
  { label: "aUSDC mint tx, wallet=pool", wallet: POOL, txHash: TX_AUSDC_MINT },
  { label: "origin deposit tx, wallet=pool", wallet: POOL, txHash: TX_ORIGIN_DEPOSIT },
  { label: "origin deposit tx, wallet=deposit", wallet: DEPOSIT, txHash: TX_ORIGIN_DEPOSIT },
];

for (const c of cases) {
  const r = await api({ chain: "base", wallet: { address: c.wallet, chain: "base" }, txHash: c.txHash });
  const sub = /^\[([A-Z]{2}_\d{3})\]/.exec(r.body?.message ?? "")?.[1] ?? null;
  const data = r.body?.data;
  const url = data?.url ?? data?.downloadUrl ?? data?.reportUrl ?? data?.fileUrl ?? null;
  console.log(`\n### ${c.label}`);
  console.log(`  txHash ${c.txHash}`);
  console.log(`  http ${r.httpStatus} code=${r.body?.code} subCode=${sub}`);
  console.log(`  message: ${r.body?.message ?? "-"}`);
  if (r.body?.code === "0000") {
    console.log(`  >>> REPORT GENERATED. url=${url ?? "(see data)"} `);
    console.log(`  data: ${JSON.stringify(data)?.slice(0, 500)}`);
  }
}
