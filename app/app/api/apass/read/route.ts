import { NextResponse } from "next/server";

import { ADDRESSES } from "@/lib/contracts";
import { queryApass, validatorVerify, verifyApass } from "@/lib/cleanverse/server";

export const dynamic = "force-dynamic";

/**
 * Read a wallet's A-Pass standing for the checkout underwriting step.
 *
 * Server-side because the AES key and api-id live here and must never reach a
 * browser bundle. The checkout screen shows what came back; it does not get to
 * assert its own standing.
 *
 * Three reads, because they answer three different questions:
 *   query_apass      what the credential says (tier, subTier, expiry, status)
 *   verify_apass     can this wallet hold the SETTLEMENT ASSET at all
 *   validator/verify does it satisfy OUR registered pool rule
 *
 * A mismatch between the last two is worth surfacing loudly rather than
 * silently picking one.
 */
export async function POST(request: Request) {
  const { address } = (await request.json()) as { address?: string };
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const [apass, token, validator] = await Promise.all([
    queryApass(address),
    verifyApass(address, ADDRESSES.kusdc),
    validatorVerify(address, ADDRESSES.pool),
  ]);

  // tier is a STRING ("50"); subTier is an INTEGER. Parse explicitly.
  const record = apass.ok ? apass.data : null;
  const tier = record ? Number.parseInt(String(record.tier), 10) : null;
  const subTier = record ? Number(record.subTier) : null;

  const tokenCode = token.ok ? ((token.data as { code?: number })?.code ?? null) : null;
  const validatorValid = validator.ok
    ? Boolean((validator.data as { valid?: boolean })?.valid)
    : null;

  // The contract mirrors the Cleanverse rule, and a mirror can drift. If the
  // validator and the token disagree about this wallet, say so.
  const disagreement =
    validatorValid !== null && tokenCode !== null && validatorValid !== (tokenCode === 4)
      ? "validator/verify and the token's own rule disagree about this wallet"
      : null;

  return NextResponse.json({
    address,
    found: apass.ok,
    // Undocumented sub-codes exist; parse the bracketed prefix, never the prose.
    subCode: /^\[([A-Z]{2}_\d{3})\]/.exec(apass.message ?? "")?.[1] ?? null,
    message: apass.message ?? null,
    credential: record
      ? {
          tier,
          subTier,
          status: record.status,
          expirationTime: Number(record.expirationTime),
          countries: record.countries,
          cvRecordId: record.cvRecordId,
          currentKycHash: record.currentKycHash,
        }
      : null,
    canHoldSettlementAsset: tokenCode === 4,
    tokenCode,
    satisfiesPoolRule: validatorValid,
    disagreement,
  });
}
