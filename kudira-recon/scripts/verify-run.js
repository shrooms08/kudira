// Reconstruct the live origination run from ON-CHAIN EVENTS, not script output.
//
// The script's own hash printing was wrong once (blockHash reported as
// transactionHash), so the authoritative record comes from the chain: sweep
// every log our contracts emitted, classify each transaction by WHAT IT
// EMITTED, and re-check every status via eth_getTransactionReceipt.
//
// The baseline auto-derives from the CURRENT pool's deployment block (binary
// search on eth_getCode), so a redeploy can never leave this sweeping a stale
// window again.
//
// Output: three groups —
//   deploy/config  (contract creation, wiring, setRule — context, not the run)
//   STAGING        (merchant registration, pool funding, borrower funding)
//   THE TAKE       (negative test, originate + payout, approve, collects)
//
// Usage:
//   FAILED_BLOCK=44998817 node scripts/verify-run.js     # auto-find the revert
//   FAILED_TX=0x...       node scripts/verify-run.js     # or give it directly

import "../src/lib/tls-compat.js"; // must be first

import { post } from "../src/lib/cleanverse-http.js";

const RPC = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

const POOL = "0x4a898781AFAd85BE7103126952BcBbFCCC24199e";
const REGISTRY = "0x05e2A2473e710435484f6B3b288677618E95bB15";
const CREDIT_LINE = "0x49cD6c00EC00116Eed598b8e07f1B0D7A4805cBE";
const PLANS = "0xb4c055e7e880A684F9276435BDc12d25577d39D8";
const KUSDC = "0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E";
const BORROWER = "0x09187143dDcbD329133a25f15B3913D2cEc88afd";
const TREASURY = "0x021Fed3a7d7367B3d4Da7812B38355014AFc808F";
const MERCHANT = "0xE8D7b7CEDC7b114D56E7828C7179c6a9b9EEe06D";

// topic0 hashes, computed with `cast sig-event` and pinned here.
const T = {
  OwnershipTransferred: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0",
  PoolUpdated: "0x90affc163f1a2dfedcd36aa02ed992eeeba8100a4014f0b4cdc20ea265a66627",
  OperatorUpdated: "0xfbe5b6cbafb274f445d7fed869dc77a838d8243a22c460de156560e8857cad03",
  RuleUpdated: "0x647685434db64ce19fd6f2363ae8e2fe17dd1183d212944e51c723ac3367d946",
  MerchantRegistered: "0x5279479dfe30a6e77c7e2920ac5dc774f863f301001473d1164f1e84c1bd0f0a",
  MerchantActiveSet: "0xe986efb56e5db845f1823c3d0a23892fce8daeb3bc1f53db4282e5c37c5e3d81",
  Funded: "0xcd909ec339185c4598a4096e174308fbdf136d117f230960f873a2f2e81f63af",
  Transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  Approval: "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  PlanOriginated: "0x44d4495d4ea70447197214d752237ae19369d5f0a53c1b841ba3930ce2cd7d61",
  MerchantPaid: "0xd945e8830f9dc928d45b069e4fcbe18efeb239e2f44e3814b8a51bd9306bd3e6",
  AutoDebited: "0x0ffb9bb5696bd2111e1e53daefd0d7b5340eaf873fb1b296c1a0342e518285cf",
  OnTime: "0x2412ed6cc4ba96390f2104175d22d0763885455e7981c86101f35b1d5d98298e",
  PlanSettled: "0xcd66898152a17cbf22781173d5d40d9735a84f21534a84eaab91f98def1cb026",
};

let id = 0;
const rpc = async (method, params) => {
  const r = await post(RPC, { jsonrpc: "2.0", id: ++id, method, params });
  if (r.error) throw new Error(r.error);
  if (r.body?.error) throw new Error(`${method}: ${r.body.error.message}`);
  return r.body?.result;
};
const pad = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const topicAddr = (t) => "0x" + t.slice(-40).toLowerCase();

// --- Baseline: the current pool's deployment block ----------------------------
const latest = Number(await rpc("eth_blockNumber", []));
let lo = latest - 50_000;
let hi = latest;
// invariant: code absent at lo, present at hi
while (lo + 1 < hi) {
  const mid = (lo + hi) >> 1;
  const code = await rpc("eth_getCode", [POOL, "0x" + mid.toString(16)]);
  if (code && code !== "0x") hi = mid;
  else lo = mid;
}
const FROM_BLOCK = hi; // pool deployment block — nothing before this can involve v4
console.log(`\nBaseline auto-derived: pool deployed at block ${FROM_BLOCK}`);
console.log(`Sweeping ${FROM_BLOCK} -> ${latest} (${latest - FROM_BLOCK} blocks)\n`);

// --- Sweep --------------------------------------------------------------------
const CHUNK = 1900;
const logs = [];
for (let start = FROM_BLOCK; start <= latest; start += CHUNK) {
  const end = Math.min(start + CHUNK - 1, latest);
  for (const address of [POOL, REGISTRY, CREDIT_LINE, PLANS, KUSDC]) {
    logs.push(
      ...(await rpc("eth_getLogs", [
        { address, fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16) },
      ])),
    );
  }
}

const byTx = new Map();
for (const l of logs.sort(
  (a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex),
)) {
  const h = l.transactionHash;
  if (!byTx.has(h)) byTx.set(h, { hash: h, block: Number(l.blockNumber), logs: [] });
  byTx.get(h).logs.push(l);
}

// --- Classify by what each tx emitted -----------------------------------------
let collectN = 0;
function classify(tx) {
  const has = (topic) => tx.logs.some((l) => l.topics[0] === topic);
  const only = (topic) => tx.logs.every((l) => l.topics[0] === topic);

  if (has(T.PlanOriginated)) return { group: "take", label: "originate + merchant paid in full (same tx)" };
  if (has(T.AutoDebited)) {
    collectN += 1;
    const ot = tx.logs.find((l) => l.topics[0] === T.OnTime);
    let grade = "no reward";
    if (ot) {
      // data words: [count, oldGrade, newGrade] — borrower is indexed, not in data
      const d = ot.data.slice(2);
      grade = `grade ${parseInt(d.slice(64, 128), 16)} -> ${parseInt(d.slice(128, 192), 16)}`;
    }
    return { group: "take", label: `collect #${collectN} (${grade})` };
  }
  if (has(T.MerchantRegistered) || has(T.MerchantActiveSet)) {
    return { group: "staging", label: "merchant registered + activated (Manila Coffee Roasters)" };
  }
  if (has(T.Funded)) return { group: "staging", label: "pool funded (5,000 KUSDC)" };
  if (only(T.Approval)) {
    const owner = topicAddr(tx.logs[0].topics[1]);
    if (owner === BORROWER.toLowerCase()) {
      return { group: "take", label: "borrower approves the pool (once, at signing)" };
    }
    if (owner === TREASURY.toLowerCase()) {
      return { group: "staging", label: "treasury approves the pool for funding" };
    }
    return { group: "staging", label: "approval" };
  }
  if (only(T.Transfer)) {
    const from = topicAddr(tx.logs[0].topics[1]);
    const to = topicAddr(tx.logs[0].topics[2]);
    if (from === TREASURY.toLowerCase() && to === BORROWER.toLowerCase()) {
      return { group: "staging", label: "borrower funded (130.00 KUSDC, treasury -> borrower)" };
    }
    return { group: "staging", label: "transfer" };
  }
  if (
    tx.logs.every((l) =>
      [T.OwnershipTransferred, T.PoolUpdated, T.OperatorUpdated, T.RuleUpdated].includes(l.topics[0]),
    )
  ) {
    return { group: "deploy", label: "deployment / wiring / setRule" };
  }
  return { group: "other", label: "unclassified — inspect by hand" };
}

const rows = [];
for (const tx of byTx.values()) {
  const receipt = await rpc("eth_getTransactionReceipt", [tx.hash]);
  const block = await rpc("eth_getBlockByNumber", ["0x" + tx.block.toString(16), false]);
  rows.push({
    ...tx,
    ...classify(tx),
    status: Number(receipt?.status) === 1 ? "success" : "FAILED",
    ts: Number(block?.timestamp),
  });
}

// --- The negative test: a reverted tx emits no logs, find it explicitly -------
let failedRow = null;
if (process.env.FAILED_TX) {
  const r = await rpc("eth_getTransactionReceipt", [process.env.FAILED_TX]);
  const b = await rpc("eth_getBlockByNumber", [r.blockNumber, false]);
  failedRow = {
    hash: process.env.FAILED_TX,
    block: Number(r.blockNumber),
    ts: Number(b.timestamp),
    label: "NEGATIVE TEST: originate at subTier 5 reverts BorrowerDelinquent",
    status: Number(r.status) === 1 ? "success (UNEXPECTED)" : "FAILED (expected)",
  };
} else if (process.env.FAILED_BLOCK) {
  // scan the named block for a failed tx addressed to the pool
  const blockHex = "0x" + Number(process.env.FAILED_BLOCK).toString(16);
  const b = await rpc("eth_getBlockByNumber", [blockHex, true]);
  for (const t of b?.transactions ?? []) {
    if ((t.to ?? "").toLowerCase() !== POOL.toLowerCase()) continue;
    const r = await rpc("eth_getTransactionReceipt", [t.hash]);
    if (Number(r.status) === 0) {
      failedRow = {
        hash: t.hash,
        block: Number(r.blockNumber),
        ts: Number(b.timestamp),
        label: "NEGATIVE TEST: originate at subTier 5 reverts BorrowerDelinquent",
        status: "FAILED (expected)",
      };
    }
  }
}

// --- Print --------------------------------------------------------------------
const table = (list, withDelta) => {
  console.log("| # | block | time | tx | what | status |");
  console.log("|---|---|---|---|---|---|");
  let prev = null;
  list.forEach((r, i) => {
    const t =
      withDelta && prev !== null
        ? `+${r.ts - prev}s`
        : new Date(r.ts * 1000).toISOString().slice(11, 19) + "Z";
    prev = r.ts;
    console.log(`| ${i + 1} | ${r.block} | ${t} | \`${r.hash}\` | ${r.label} | ${r.status} |`);
  });
};

const deploy = rows.filter((r) => r.group === "deploy");
const staging = rows.filter((r) => r.group === "staging");
const take = [...(failedRow ? [failedRow] : []), ...rows.filter((r) => r.group === "take")].sort(
  (a, b) => a.block - b.block,
);
const other = rows.filter((r) => r.group === "other");

console.log(`Deploy/config transactions (context, not part of the run): ${deploy.length}`);
for (const r of deploy) console.log(`  ${r.block}  ${r.hash}`);

console.log("\n## Staging\n");
table(staging, false);

console.log("\n## The take\n");
table(take, true);
if (!failedRow) console.log("\n(negative test missing — pass FAILED_TX or FAILED_BLOCK)");
if (other.length) {
  console.log("\nUNCLASSIFIED (inspect):");
  for (const r of other) console.log(`  ${r.block}  ${r.hash}`);
}

// --- Final state, fresh reads with verified selectors -------------------------
const call = async (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
// Selectors verified with `cast sig`; empty returns throw rather than read as 0.
const SEL = {
  gradeOf: "0xf1fcdd2b", // gradeOf(address)
  limitOf: "0x546a2ca4", // limitOf(address)
  balanceOf: "0x70a08231",
  wasEverLate: "0x7eaada06", // wasEverLate(uint256)
  statusOf: "0xad35efd4", // statusOf(uint256)
};
const readUint = async (to, sel, argHex) => {
  const r = await call(to, sel + argHex);
  if (!r || r === "0x") throw new Error(`empty return for ${sel} — selector wrong?`);
  return BigInt(r);
};
const planIdArg = (1n).toString(16).padStart(64, "0");

console.log("\nFinal state (fresh eth_call):");
console.log(`  borrower grade   ${await readUint(CREDIT_LINE, SEL.gradeOf, pad(BORROWER))}`);
console.log(`  borrower limit   ${await readUint(CREDIT_LINE, SEL.limitOf, pad(BORROWER))}`);
console.log(`  wasEverLate(1)   ${(await readUint(PLANS, SEL.wasEverLate, planIdArg)) === 1n}`);
console.log(`  plan 1 status    ${await readUint(PLANS, SEL.statusOf, planIdArg)}  (2 = Completed)`);
console.log(`  pool KUSDC       ${await readUint(KUSDC, SEL.balanceOf, pad(POOL))}`);
console.log(
  `  merchant KUSDC   ${await readUint(KUSDC, SEL.balanceOf, pad(MERCHANT))}  (cumulative across deployments)`,
);
console.log("");
