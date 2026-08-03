import { NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ADDRESSES } from "@/lib/contracts";
import { validatorVerify, verifyApass } from "@/lib/cleanverse/server";

export const dynamic = "force-dynamic";

/**
 * The compliance check that DOES work: `validator/verify` against our registered
 * pool rule, called live.
 *
 * Called with no body it runs the demonstration pair — a wallet we credentialed,
 * and a wallet generated in this request that has never existed before — so the
 * true/false contrast is produced in real time rather than from fixtures. The
 * fresh address is generated server-side per call, which is what makes it
 * unfakeable: it cannot have been prepared.
 */
export async function POST(request: Request) {
  let body: { address?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* no body is the normal case for the demo pair */
  }

  const subjects: Array<{ label: string; address: string; note: string }> = [];

  if (body.address) {
    subjects.push({ label: "Requested wallet", address: body.address, note: "" });
  } else {
    subjects.push({
      label: "Credentialed wallet",
      address: ADDRESSES.pool,
      note: "Holds an A-Pass we issued. tier \"50\" clears the pool rule's min_tier 5.",
    });
    subjects.push({
      label: "Freshly generated wallet",
      address: privateKeyToAccount(generatePrivateKey()).address,
      note: "Generated in this request. Has never held a credential, and could not have been prepared.",
    });
  }

  const results = await Promise.all(
    subjects.map(async (s) => {
      const [validator, token] = await Promise.all([
        validatorVerify(s.address, ADDRESSES.pool),
        verifyApass(s.address, ADDRESSES.kusdc),
      ]);
      return {
        ...s,
        // validator/verify: does this wallet satisfy OUR pool's registered rule?
        valid: validator.ok ? Boolean((validator.data as { valid?: boolean })?.valid) : null,
        validatorRaw: validator.raw ?? { error: validator.error },
        // verify_apass: does it satisfy the settlement TOKEN's transfer rule?
        // 4 = allowed, 2 = no A-Pass.
        tokenCode: token.ok ? ((token.data as { code?: number })?.code ?? null) : null,
        tokenMessage: (token.data as { message?: string })?.message ?? token.error ?? null,
      };
    }),
  );

  return NextResponse.json({
    pool: ADDRESSES.pool,
    atoken: ADDRESSES.kusdc,
    checkedAt: new Date().toISOString(),
    results,
  });
}
