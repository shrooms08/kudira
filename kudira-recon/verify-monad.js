// Raw JSON-RPC probe — is anything actually deployed at the registry's addresses?
//
// The Cleanverse registry reports contract addresses for chain "monad". This
// script asks the chains themselves, bypassing the registry entirely:
//   - eth_chainId      -> which network did we actually reach?
//   - eth_getCode      -> is there bytecode at each address?  "0x" means nothing.
//   - eth_getStorageAt -> all three are ERC-1967 proxies, and every proxy shell
//                         is byte-identical on every chain. Comparing only the
//                         proxy bytecode therefore proves nothing. The EIP-1967
//                         implementation slot is where the real answer lives.
//
// Rules honoured here:
//   - Read-only. Only eth_chainId / eth_getCode. No writes, no keys, no signing.
//   - No Cleanverse credentials are read or sent — these are public RPC calls.
//   - Every response (including errors) is surfaced, never swallowed.

import "./src/lib/tls-compat.js"; // must be first: fixes the TLS handshake to the sandbox

import { createHash } from "node:crypto";

// --- Targets ------------------------------------------------------------------

const ADDRESSES = [
  { label: "aUSDC (per registry)", address: "0xaC0893567D43C3E7e6e35a72803df05416C1f20D" },
  { label: "accesscore",           address: "0x8F118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC" },
  { label: "apass",                address: "0xbA82D189540CaC9DC6FF46B6837CaC1BFdEC58B9" },
];

// Monad testnet is the default: the registry we probed is the UAT/sandbox API.
// Monad mainnet is included so a "nothing deployed" verdict can't be an artifact
// of picking the wrong Monad network. Override any of these via env.
const NETWORKS = [
  {
    key: "monad",
    name: "Monad testnet",
    url: process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
    expectedChainId: 10143,
  },
  {
    key: "monad-mainnet",
    name: "Monad mainnet",
    url: process.env.MONAD_MAINNET_RPC_URL ?? "https://rpc.monad.xyz",
    expectedChainId: 143,
  },
  {
    key: "base-sepolia",
    name: "Base Sepolia",
    url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
    expectedChainId: 84532,
  },
];

const REQUEST_TIMEOUT_MS = 20_000;

// EIP-1967: keccak256("eip1967.proxy.implementation") - 1
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// A control address that must come back "0x". If an RPC claims code here it is
// answering nonsense and every other result from it is worthless.
const CONTROL_ADDRESS = "0x000000000000000000000000000000000000dEaD";

// --- JSON-RPC -----------------------------------------------------------------

let rpcId = 0;

async function rpc(url, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      signal: controller.signal,
    });

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { error: `http ${res.status}, non-JSON body: ${text.slice(0, 160)}` };
    }
    if (body.error) {
      return { error: `rpc error ${body.error.code}: ${body.error.message}` };
    }
    if (!res.ok) {
      return { error: `http ${res.status}` };
    }
    return { result: body.result };
  } catch (err) {
    return { error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

// --- Probing ------------------------------------------------------------------

// "0x" (or "0x0", or empty) means no contract deployed at that address.
function describeCode(code) {
  const hex = (code ?? "").replace(/^0x/, "");
  const bytes = hex.length / 2;
  return {
    hasCode: bytes > 0,
    bytes,
    // Bytecode digest — identical digests across two chains means the same
    // contract was deployed on both, which is what a real cross-chain deploy
    // looks like. It does NOT by itself prove the registry is honest.
    sha256: bytes > 0 ? createHash("sha256").update(hex.toLowerCase()).digest("hex").slice(0, 16) : null,
  };
}

async function probeNetwork(net) {
  console.log("─".repeat(72));
  console.log(`▶ ${net.name}  ${net.url}`);

  const out = { ...net, chainId: null, chainIdHex: null, chainIdError: null, codes: [] };

  const chain = await rpc(net.url, "eth_chainId", []);
  if (chain.error) {
    out.chainIdError = chain.error;
    console.log(`  eth_chainId: ✖ ${chain.error}`);
  } else {
    out.chainIdHex = chain.result;
    out.chainId = Number.parseInt(chain.result, 16);
    const match =
      out.chainId === net.expectedChainId
        ? "matches expected"
        : `EXPECTED ${net.expectedChainId} — different network!`;
    console.log(`  eth_chainId: ${chain.result} (${out.chainId}) — ${match}`);
  }

  // Sanity control: a burn address must report no code.
  const control = await rpc(net.url, "eth_getCode", [CONTROL_ADDRESS, "latest"]);
  out.controlSane = !control.error && !describeCode(control.result).hasCode;
  console.log(
    `  control ${CONTROL_ADDRESS} -> ${
      control.error ? `ERR ${control.error}` : `"${control.result}"`
    } ${out.controlSane ? "(sane)" : "(SUSPECT — endpoint reports code at a burn address)"}`,
  );

  for (const target of ADDRESSES) {
    console.log(`  ${target.address}  ${target.label}`);

    const res = await rpc(net.url, "eth_getCode", [target.address, "latest"]);
    if (res.error) {
      out.codes.push({ ...target, error: res.error, hasCode: null, bytes: null, sha256: null });
      console.log(`      ✖ ${res.error}`);
      continue;
    }
    const d = describeCode(res.result);
    const entry = { ...target, error: null, raw: res.result, ...d, impl: null, implBytes: null };
    console.log(
      `      bytecode: ${d.hasCode ? "YES" : "NO "}   length: ${d.bytes} bytes` +
        (d.hasCode ? `   sha256: ${d.sha256}…` : `   (returned "${res.result}")`),
    );

    // Proxy shells are cheap and identical everywhere; resolve what they delegate to.
    if (d.hasCode) {
      const slot = await rpc(net.url, "eth_getStorageAt", [
        target.address,
        EIP1967_IMPL_SLOT,
        "latest",
      ]);
      if (slot.error) {
        console.log(`      impl slot: ✖ ${slot.error}`);
      } else if (/^0x0*$/.test(slot.result ?? "")) {
        console.log("      impl slot: empty — not an ERC-1967 proxy, or unset (a shell)");
      } else {
        entry.impl = "0x" + String(slot.result).slice(-40);
        const implCode = await rpc(net.url, "eth_getCode", [entry.impl, "latest"]);
        if (implCode.error) {
          console.log(`      impl ${entry.impl}: ✖ ${implCode.error}`);
        } else {
          const di = describeCode(implCode.result);
          entry.implBytes = di.bytes;
          console.log(
            `      impl ${entry.impl}  logic bytecode: ${di.hasCode ? "YES" : "NO "}  ${di.bytes} bytes`,
          );
        }
      }
    }

    out.codes.push(entry);
  }

  return out;
}

// --- Run ----------------------------------------------------------------------

console.log("\nMonad deployment check — raw JSON-RPC, read-only\n");
console.log("Addresses under test (as reported by the Cleanverse registry for chain=monad):");
for (const t of ADDRESSES) console.log(`  ${t.address}  ${t.label}`);
console.log("");

const results = [];
for (const net of NETWORKS) results.push(await probeNetwork(net));

// --- Summary table ------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const cell = (c) => {
  if (!c || c.error) return "ERR";
  if (!c.hasCode) return "no/0B";
  return `yes/${c.bytes}B${c.implBytes ? `+${c.implBytes}B` : ""}`;
};

console.log("─".repeat(72));
console.log("\nSUMMARY  (proxy bytecode / + implementation bytecode)\n");

const labelW = Math.max(...ADDRESSES.map((t) => t.label.length), 8);
const netW = Math.max(
  ...results.map((r) => Math.max(r.name.length, ...r.codes.map((c) => cell(c).length))),
  12,
);
console.log([pad("address", 44), pad("label", labelW), ...results.map((r) => pad(r.name, netW))].join(" | "));
console.log(
  [pad("", 44), pad("", labelW), ...results.map(() => pad("", netW))]
    .map((s) => s.replace(/ /g, "-"))
    .join("-+-"),
);
for (let i = 0; i < ADDRESSES.length; i++) {
  console.log(
    [
      pad(ADDRESSES[i].address, 44),
      pad(ADDRESSES[i].label, labelW),
      ...results.map((r) => pad(cell(r.codes[i] ?? { error: "no data" }), netW)),
    ].join(" | "),
  );
}

console.log("\nchainId per endpoint:");
for (const r of results) {
  console.log(
    `  ${pad(r.name, netW)} -> ${
      r.chainIdError ? `ERR (${r.chainIdError})` : `${r.chainIdHex} / ${r.chainId}`
    }`,
  );
}

// --- Verdict ------------------------------------------------------------------

const byKey = (k) => results.find((r) => r.key === k);
// "Live" means the proxy has code AND it delegates to an implementation that
// also has code on that same chain. A proxy alone is an empty shell.
const liveCount = (r) =>
  r ? r.codes.filter((c) => c.hasCode === true && c.implBytes > 0).length : 0;
const proxyCount = (r) => (r ? r.codes.filter((c) => c.hasCode === true).length : 0);
const reachable = (r) => Boolean(r && !r.chainIdError && r.controlSane);

const monadTest = byKey("monad");
const monadMain = byKey("monad-mainnet");
const baseSep = byKey("base-sepolia");

const bestMonad = liveCount(monadTest) >= liveCount(monadMain) ? monadTest : monadMain;
const onMonad = liveCount(bestMonad);
const monadProxies = proxyCount(bestMonad);
const onBase = liveCount(baseSep);
const monadReachable = reachable(monadTest) || reachable(monadMain);
const N = ADDRESSES.length;

// Distinct implementation addresses are the strongest evidence of an independent
// deploy: an echo of Base data cannot produce different logic contracts on Monad.
const distinctImpls = (bestMonad?.codes ?? []).filter(
  (c, i) => c.impl && baseSep?.codes?.[i]?.impl && c.impl !== baseSep.codes[i].impl,
).length;

let verdict;
if (!monadReachable) {
  verdict = `INCONCLUSIVE — no Monad RPC endpoint answered sanely (${monadTest?.chainIdError ?? "control check failed"}); ${onBase}/${N} live on Base Sepolia.`;
} else if (monadProxies === 0 && onBase > 0) {
  verdict = `REGISTRY IS ECHOING BASE DATA — 0/${N} addresses have any bytecode on Monad, but ${onBase}/${N} are live on Base Sepolia.`;
} else if (monadProxies === 0) {
  verdict = `NOT DEPLOYED ANYWHERE PROBED — 0/${N} addresses have bytecode on Monad or Base Sepolia.`;
} else if (onMonad === 0) {
  verdict = `SHELLS ONLY ON MONAD — ${monadProxies}/${N} proxies exist on ${bestMonad.name} but none delegate to a deployed implementation there. Not usable.`;
} else if (onMonad === N) {
  verdict =
    `DEPLOYED ON MONAD, NOT AN ECHO — all ${N} proxies on ${bestMonad.name} delegate to implementations that carry bytecode on Monad` +
    (distinctImpls
      ? `; ${distinctImpls}/${N} resolve to implementation addresses different from Base Sepolia, so these are independent deploys.`
      : `, though all implementation addresses match Base Sepolia (deterministic CREATE2 deploy of the same logic).`);
} else {
  verdict = `PARTIAL — ${onMonad}/${N} fully live on ${bestMonad.name} (${monadProxies}/${N} proxies present) vs ${onBase}/${N} on Base Sepolia. Treat the Monad registry entry as unreliable until all ${N} resolve.`;
}

console.log("\nVERDICT");
console.log(`  ${verdict}\n`);
