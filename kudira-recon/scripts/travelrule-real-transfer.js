// Step 5: download_travel_rule against a REAL customer-to-customer aUSDC transfer
// (treasury -> merchant, both credentialed). The decisive test of whether an
// aUSDC settlement inside the indexed flow generates a Travel Rule report.
// Read-only.
//
//   node scripts/travelrule-real-transfer.js

import "../src/lib/tls-compat.js";

import { loadEnv } from "../load-env.js";
import { BASE_URL, post } from "../src/lib/cleanverse-http.js";

loadEnv(new URL("../.env", import.meta.url));
const API_ID = process.env.CLEANVERSE_API_ID;

const TX = "0xb91c3783a3c30deb906a94ec34e5630010d890607418f15bc49f6bd8a8884b81";
const TRE = "0x021Fed3a7d7367B3d4Da7812B38355014AFc808F";
const MER = "0xE8D7b7CEDC7b114D56E7828C7179c6a9b9EEe06D";

const call = (addr) =>
  post(`${BASE_URL}/download_travel_rule`, { chain: "base", wallet: { address: addr, chain: "base" }, txHash: TX }, { "api-id": API_ID });

for (const [label, addr] of [["treasury (sender)", TRE], ["merchant (recipient)", MER]]) {
  const r = await call(addr);
  const sub = /^\[([A-Z]{2}_\d{3})\]/.exec(r.body?.message ?? "")?.[1] ?? null;
  console.log(`\n### wallet = ${label}`);
  console.log(`  http ${r.httpStatus} code=${r.body?.code} subCode=${sub}`);
  console.log(`  message: ${r.body?.message ?? "-"}`);
  if (r.body?.code === "0000") {
    console.log("  >>> REPORT GENERATED");
    console.log("  data:", JSON.stringify(r.body?.data, null, 2));
  }
}
