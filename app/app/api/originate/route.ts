import { NextResponse } from "next/server";
import { BaseError, ContractFunctionRevertedError } from "viem";

import { queryApass, validatorVerify } from "@/lib/cleanverse/server";
import { getComplianceOnChain, publicClient } from "@/lib/chain";
import { ACTORS, ADDRESSES, erc20Abi, poolAbi } from "@/lib/contracts";
import { operatorSigner } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * Server-side origination. The operator key lives here (server-only) so the
 * buyer's Confirm can create the plan without the buyer being the operator.
 *
 * Nothing the client sends about the borrower's standing is trusted: the A-Pass
 * is re-read server-side, and eligibility is checked two independent ways
 * (validator/verify REST and complianceVerify on the CCP validator). If those
 * disagree we refuse rather than pick one. The merchant is never client-supplied.
 *
 * simulateContract runs the exact on-chain originate, so its named reverts
 * (ExceedsCreditLimit, InsufficientLiquidity, ...) become friendly reasons, and
 * on success it yields the planId before we broadcast.
 */

const DUE_EVERY = 604800n; // weekly — matches the account page and originate-plan.sh
const MERCHANT = ACTORS.merchant; // forced server-side, never from the client

function refuse(reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, reason, ...extra });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    borrower?: string;
    principal?: string | number;
    installments?: number;
  };

  const borrower = body.borrower;
  if (!borrower || !/^0x[0-9a-fA-F]{40}$/.test(borrower)) {
    return NextResponse.json({ ok: false, reason: "bad_borrower" }, { status: 400 });
  }
  let principal: bigint;
  try {
    principal = BigInt(body.principal ?? 0);
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_principal" }, { status: 400 });
  }
  if (principal <= 0n) return NextResponse.json({ ok: false, reason: "bad_principal" }, { status: 400 });
  // Only 3, 4 or 6 are offered. Re-validate server-side; never trust the client.
  const installments = Number(body.installments ?? 4);
  if (![3, 4, 6].includes(installments)) {
    return NextResponse.json({ ok: false, reason: "bad_installments" }, { status: 400 });
  }

  // 1. Re-read the A-Pass server-side. Never trust anything the client sent.
  const apass = await queryApass(borrower);
  if (!apass.ok || !apass.data) return refuse("no_apass", { detail: apass.message ?? null });
  const tier = Number.parseInt(String(apass.data.tier), 10); // tier is a STRING
  const subTier = Number(apass.data.subTier); // subTier is an INTEGER
  const expiry = BigInt(Number(apass.data.expirationTime)); // unix seconds
  const status = Number(apass.data.status);
  if (!Number.isFinite(tier) || !Number.isFinite(subTier)) return refuse("apass_unreadable");
  if (status !== 1) return refuse("apass_inactive", { status });

  // 2. Two independent eligibility checks: REST validator/verify and the on-chain
  //    complianceVerify twin. Disagreement is a refusal, not a coin toss.
  const [validator, onchain] = await Promise.all([
    validatorVerify(borrower, ADDRESSES.pool),
    getComplianceOnChain([borrower as `0x${string}`]),
  ]);
  const restValid = validator.ok ? Boolean((validator.data as { valid?: boolean })?.valid) : null;
  const chainValid = onchain.verify[borrower.toLowerCase()] ?? null;
  if (restValid === null) return refuse("validator_unreachable");
  if (chainValid === null) return refuse("compliance_unreadable");
  if (restValid !== chainValid) return refuse("compliance_disagreement", { restValid, chainValid });
  if (!chainValid) return refuse("not_compliant");

  // 3. Our own policy check (the contract does NOT check allowance at originate):
  //    the buyer must have approved at least the first installment, or the plan
  //    is born un-collectable.
  const firstInstallment = principal / BigInt(installments);
  const allowance = (await publicClient.readContract({
    address: ADDRESSES.kusdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [borrower as `0x${string}`, ADDRESSES.pool],
  })) as bigint;
  if (allowance < firstInstallment) {
    return refuse("allowance_too_low", { allowance: allowance.toString(), needed: firstInstallment.toString() });
  }

  // 4. simulate the exact originate as the operator. This is the authoritative
  //    pre-flight: every contract revert decodes to a named reason, and success
  //    yields the planId before we broadcast.
  const { account, wallet } = operatorSigner();
  let planId: bigint;
  let simRequest;
  try {
    const sim = await publicClient.simulateContract({
      account,
      address: ADDRESSES.pool,
      abi: poolAbi,
      functionName: "originate",
      args: [borrower as `0x${string}`, MERCHANT, principal, installments, DUE_EVERY, tier, subTier, expiry],
    });
    planId = sim.result as bigint;
    simRequest = sim.request;
  } catch (err) {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        return refuse("originate_reverts", {
          errorName: revert.data?.errorName ?? "unknown",
          args: revert.data?.args?.map((a) => String(a)) ?? [],
        });
      }
      return refuse("originate_reverts", { detail: err.shortMessage });
    }
    return refuse("originate_reverts", { detail: (err as Error).message.split("\n")[0] });
  }

  // 5. Broadcast as the operator.
  let txHash: `0x${string}`;
  try {
    txHash = await wallet.writeContract(simRequest);
  } catch (err) {
    return refuse("broadcast_failed", { detail: (err as Error).message.split("\n")[0] });
  }

  // 6. Best-effort confirmation, bounded so we never hit the function timeout.
  //    Either way the buyer gets the real tx hash to watch on Basescan.
  let confirmed = false;
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 8_000, confirmations: 1 });
    confirmed = receipt.status === "success";
  } catch {
    /* still pending; the client can watch the hash */
  }

  return NextResponse.json({
    ok: true,
    txHash,
    planId: planId.toString(),
    confirmed,
    merchant: MERCHANT,
    principal: principal.toString(),
    installments,
  });
}
