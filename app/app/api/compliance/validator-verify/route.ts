import { NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { getComplianceOnChain } from "@/lib/chain";
import { ACTORS, ADDRESSES } from "@/lib/contracts";
import { validatorVerify, verifyApass } from "@/lib/cleanverse/server";

export const dynamic = "force-dynamic";

/**
 * Compliance, checked two independent ways for the same wallets:
 *
 *   REST      `validator/verify` against our registered pool rule (Cleanverse API)
 *   ON-CHAIN  `complianceVerify(pool, wallet)` read from the CCP validator contract
 *
 * Both answer the same question — does this wallet satisfy our pool's rule — so
 * they should always agree. The panel labels which is which and flags any
 * divergence loudly rather than picking a winner: a mismatch between the API and
 * the chain is the single most interesting thing this screen could surface.
 *
 * Called with no body it runs the demonstration trio:
 *   - a credentialed EOA (the borrower) — holds an A-Pass, tier "50" clears min_tier 5
 *   - a wallet generated in THIS request — has never existed, cannot be prepared
 *   - the pool contract itself — a contract holding a credential, which is why it
 *     can custody the settlement CVA
 */
export async function POST(request: Request) {
  let body: { address?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* no body is the normal case for the demo trio */
  }

  const subjects: Array<{ label: string; address: `0x${string}`; note: string }> = [];

  if (body.address) {
    subjects.push({ label: "Requested wallet", address: body.address as `0x${string}`, note: "" });
  } else {
    subjects.push({
      label: "Credentialed wallet",
      address: ACTORS.borrower,
      note: "The borrower. Holds an A-Pass we issued; tier \"50\" clears the pool rule's min_tier 5.",
    });
    subjects.push({
      label: "Freshly generated wallet",
      address: privateKeyToAccount(generatePrivateKey()).address,
      note: "Generated in this request. Has never held a credential, and could not have been prepared.",
    });
    subjects.push({
      label: "Pool contract",
      address: ADDRESSES.pool,
      note: "The pool itself. A contract can hold an A-Pass, which is why it can custody the settlement CVA.",
    });
  }

  // On-chain: one multicall covering isRegistered, getRulesV2, and
  // complianceVerify for every subject at once.
  const onChain = await getComplianceOnChain(subjects.map((s) => s.address));

  const results = await Promise.all(
    subjects.map(async (s) => {
      const [validator, token] = await Promise.all([
        validatorVerify(s.address, ADDRESSES.pool),
        verifyApass(s.address, ADDRESSES.kusdc),
      ]);
      // REST: does this wallet satisfy OUR pool's registered rule?
      const restValid = validator.ok
        ? Boolean((validator.data as { valid?: boolean })?.valid)
        : null;
      // ON-CHAIN: the same question, read from the CCP validator contract.
      const chainValid = onChain.verify[s.address.toLowerCase()] ?? null;
      // Agreement is only meaningful when the REST call actually answered.
      const agree = restValid === null ? null : restValid === chainValid;
      return {
        ...s,
        restValid,
        chainValid,
        agree,
        validatorRaw: validator.raw ?? { error: validator.error },
        // verify_apass: does it satisfy the settlement CVA's transfer rule?
        // 4 = allowed, 2 = no A-Pass.
        tokenCode: token.ok ? ((token.data as { code?: number })?.code ?? null) : null,
        tokenMessage: (token.data as { message?: string })?.message ?? token.error ?? null,
      };
    }),
  );

  const anyDisagreement = results.some((r) => r.agree === false);

  // The stored rule, serialised for the client (bigint -> string).
  const rules = onChain.rules.map((r) => ({
    allowedGroup: r.allowedGroup,
    allowedSubGroup: r.allowedSubGroup,
    minTier: r.minTier,
    minSubTier: r.minSubTier,
    poolCountryBitmap: r.poolCountryBitmap.toString(),
  }));

  return NextResponse.json({
    pool: ADDRESSES.pool,
    atoken: ADDRESSES.kusdc,
    validator: ADDRESSES.ccpValidator,
    checkedAt: new Date().toISOString(),
    onChain: { registered: onChain.registered, rules },
    anyDisagreement,
    results,
  });
}
