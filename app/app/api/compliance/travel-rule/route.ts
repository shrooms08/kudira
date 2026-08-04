import { NextResponse } from "next/server";

import { ADDRESSES } from "@/lib/contracts";
import { downloadTravelRule } from "@/lib/cleanverse/server";

export const dynamic = "force-dynamic";

/**
 * Travel Rule report for a settlement transaction.
 *
 * This calls the REAL endpoint and returns whatever it says, verbatim. It does
 * not mock a PDF. When Cleanverse cannot produce a report we surface the actual
 * error code, because the failure is itself the finding — see the diagnosis
 * attached to each known code below.
 *
 * What probing established:
 *   TR_001  our wallet is recognised, but the transaction is not indexed
 *   CV_100  the wallet does not belong to this institution's customers
 *
 * That contrast is the diagnostic: ownership scoping PASSES and transaction
 * lookup FAILS, which isolates the cause to indexing rather than to
 * permissions, payload shape, or the wallet.
 */
export async function POST(request: Request) {
  const { txHash, wallet } = (await request.json()) as { txHash?: string; wallet?: string };

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "txHash required" }, { status: 400 });
  }
  const walletAddress = wallet ?? ADDRESSES.pool;

  const result = await downloadTravelRule(walletAddress, txHash);

  // Cleanverse sub-codes arrive as a bracketed prefix on `message`. Parse the
  // prefix; never string-match the prose.
  const subCode = /^\[([A-Z]{2}_\d{3})\]/.exec(result.message ?? "")?.[1] ?? null;

  const diagnosis =
    subCode === "TR_001"
      ? {
          headline: "Not indexed for Travel Rule",
          detail:
            "Travel Rule reporting is bound to Cleanverse's indexed settlement flow. KUSDC sits outside it: a CVA (Cleanverse Verified Asset) with no deposit pair, issued through Cleanverse's documented /atoken/launch path after the Base faucet stopped dispensing aUSDC on 24 July. Settle in aUSDC and this record generates. The compliance layer isn't missing; the asset is outside its index.",
          proof:
            "The wallet was accepted. A wallet belonging to another institution returns CV_100 instead, so ownership scoping passed and only the transaction lookup failed.",
        }
      : subCode === "CV_100"
        ? {
            headline: "Wallet is not ours",
            detail:
              "Travel Rule reports are scoped to the requesting institution's own customers. This wallet was issued by someone else.",
            proof: null,
          }
        : null;

  return NextResponse.json({
    request: { chain: "base", wallet: { address: walletAddress, chain: "base" }, txHash },
    response: result.raw ?? { error: result.error },
    ok: result.ok,
    code: result.code ?? null,
    subCode,
    message: result.message ?? result.error ?? null,
    diagnosis,
  });
}
