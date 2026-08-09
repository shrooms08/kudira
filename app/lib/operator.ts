import "server-only";

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { RPC_URL } from "./contracts";

/**
 * The operator signer for server-side origination.
 *
 * `import "server-only"` is the same guard the AES key uses: any client bundle
 * that transitively imports this file fails the build, so `OPERATOR_PRIVATE_KEY`
 * can never be inlined into browser JS. It is read lazily so a missing env var
 * surfaces as a clean 500 at request time, not a crash at module load.
 *
 * The operator role is non-custodial by contract: it can originate plans and
 * mark defaults, but cannot withdraw liquidity or change policy, and funds only
 * ever flow to the registry-active merchant.
 */
let cached: { account: ReturnType<typeof privateKeyToAccount>; wallet: ReturnType<typeof createWalletClient> } | null = null;

export function operatorSigner() {
  if (cached) return cached;
  const raw = process.env.OPERATOR_PRIVATE_KEY;
  if (!raw) throw new Error("OPERATOR_PRIVATE_KEY is not set");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
  cached = { account, wallet };
  return cached;
}
