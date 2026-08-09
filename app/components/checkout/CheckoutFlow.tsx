"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  useAccount,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Amount, Card, Eyebrow, GradeBadge, Logo } from "@/components/brand/Primitives";
import { ADDRESSES, CHAIN_ID, creditLineAbi, erc20Abi } from "@/lib/contracts";
import { explorerTx, formatAmount, formatGrade, shortAddress } from "@/lib/format";

const INSTALLMENTS = 4;
const DEFAULT_TOTAL = 130_000_000n;

type ApassRead = {
  address: string;
  found: boolean;
  subCode: string | null;
  message: string | null;
  credential: {
    tier: number | null;
    subTier: number | null;
    status: number | null;
    expirationTime: number;
    countries: string[];
    cvRecordId: string;
    currentKycHash: string;
  } | null;
  canHoldSettlementAsset: boolean;
  tokenCode: number | null;
  satisfiesPoolRule: boolean | null;
  disagreement: string | null;
};

export function CheckoutFlow({ amount }: { amount?: bigint }) {
  // The bag total from the storefront, floored at 0. Falls back to the demo
  // default when the checkout is opened directly without a cart.
  const TOTAL = amount && amount > 0n ? amount : DEFAULT_TOTAL;
  // The buyer picks the installment count at the offer step. Default 4 keeps the
  // flow identical when untouched; only 3, 4, 6 are offered and the server
  // re-validates. per = floor(principal / n), matching the contract, so the
  // final installment carries the remainder exactly as the chain does.
  const [installments, setInstallments] = useState<number>(INSTALLMENTS);
  const PER = TOTAL / BigInt(installments);
  const hasRemainder = TOTAL % BigInt(installments) !== 0n;

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  // A wallet can be connected but on the wrong network. Catch that at connect,
  // not at the signing step: an approve on Ethereum mainnet fails with an opaque
  // "not enough gas" because there is no KUSDC or plan there at all.
  //
  // chainId MUST come from useAccount() (the connector's actual chain), NOT
  // useChainId(). useChainId() reads the wagmi *config* state, and the config in
  // WalletProvider registers only baseSepolia. wagmi never adopts a chain that
  // isn't in that list, so on Ethereum mainnet useChainId() would still report
  // 84532 and this guard could never see a mismatch. Do not "simplify" this back
  // to useChainId() — it silently disables the whole check.
  //
  // undefined means the connector cannot report a chain: treat that as wrong,
  // never as valid. An unknown chain must block signing, not fall through.
  const wrongChain = isConnected && chainId !== CHAIN_ID;

  const [apass, setApass] = useState<ApassRead | null>(null);
  const [reading, setReading] = useState(false);

  // Origination: the buyer's Confirm creates the plan server-side (operator key).
  const [originating, setOriginating] = useState(false);
  const [originated, setOriginated] = useState<{ txHash: string; planId: string } | null>(null);
  const [originateError, setOriginateError] = useState<string | null>(null);

  // Standing comes from the chain, not from the API read — the on-chain grade is
  // canonical between deliberate syncs.
  const { data: band } = useReadContract({
    address: ADDRESSES.creditLine,
    abi: creditLineAbi,
    functionName: "bandOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  const { data: available } = useReadContract({
    address: ADDRESSES.creditLine,
    abi: creditLineAbi,
    functionName: "availableCredit",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: ADDRESSES.kusdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, ADDRESSES.pool] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { writeContract, data: approveHash, isPending: approving, error: approveError } = useWriteContract();
  const { isLoading: confirming, isSuccess: approved } = useWaitForTransactionReceipt({ hash: approveHash });

  useEffect(() => {
    if (approved) refetchAllowance();
  }, [approved, refetchAllowance]);

  // Step 2 fires as soon as a wallet is connected: read the credential.
  useEffect(() => {
    if (!address) return;
    setReading(true);
    setApass(null);
    fetch("/api/apass/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((r) => r.json())
      .then(setApass)
      .finally(() => setReading(false));
  }, [address]);

  const hasAllowance = typeof allowance === "bigint" && allowance >= TOTAL;
  const eligible = apass?.satisfiesPoolRule === true && apass?.canHoldSettlementAsset === true;

  async function confirmPlan() {
    if (!address || originating) return;
    setOriginating(true);
    setOriginateError(null);
    try {
      const res = await fetch("/api/originate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrower: address, principal: TOTAL.toString(), installments }),
      });
      const data = await res.json();
      if (data.ok) setOriginated({ txHash: data.txHash, planId: String(data.planId) });
      else setOriginateError(originateReason(data));
    } catch {
      setOriginateError("Network error reaching the originator. Try again.");
    } finally {
      setOriginating(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--paper)", paddingBottom: 140 }}>
      <header
        style={{
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href="/" style={{ fontSize: 15, color: "var(--ink-62)" }}>
          ‹
        </Link>
        <Logo />
        <span style={{ width: 12 }} />
      </header>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "8px 20px", display: "grid", gap: 12 }}>
        {/* --- Step 1: connect ------------------------------------------- */}
        <Card>
          <Eyebrow>Step 1 of 3</Eyebrow>
          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--font-source-serif)",
              fontSize: 25,
              letterSpacing: "-0.02em",
            }}
          >
            {isConnected ? "Wallet connected" : "Connect your wallet"}
          </div>
          {isConnected ? (
            <div className="num" style={{ marginTop: 10, fontSize: 13, color: "var(--ink-68)" }} title={address}>
              {shortAddress(address, 6)}
            </div>
          ) : (
            <>
              <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-62)", lineHeight: 1.6 }}>
                Kudira reads the standing on your A-Pass. It never sees your name, documents or
                account numbers.
              </p>
              <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {connectors.map((c) => (
                  <button
                    key={c.uid}
                    onClick={() => connect({ connector: c })}
                    disabled={connecting}
                    className="btn-amber"
                    style={{ padding: "12px 22px", fontSize: 14, border: "none", cursor: "pointer" }}
                  >
                    {connecting ? "Connecting…" : `Connect ${c.name}`}
                  </button>
                ))}
                {connectors.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--ink-55)" }}>
                    No browser wallet detected. Install one and reload.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </Card>

        {/* --- Wrong network: block everything downstream until it is fixed -- */}
        {isConnected && wrongChain ? (
          <Card style={{ border: "1px solid var(--ink-16)" }}>
            <Eyebrow>Wrong network</Eyebrow>
            <div
              style={{
                marginTop: 8,
                fontFamily: "var(--font-source-serif)",
                fontSize: 25,
                letterSpacing: "-0.02em",
              }}
            >
              Switch to Base Sepolia
            </div>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-62)", lineHeight: 1.6 }}>
              Your wallet is on chain <span className="num">{chainId ?? "unknown"}</span>. Kudira
              lives on Base Sepolia (<span className="num">{CHAIN_ID}</span>). Nothing can be signed
              until you switch, so we stop you here rather than at the payment step.
            </p>
            <button
              onClick={() => switchChain({ chainId: CHAIN_ID })}
              disabled={switching}
              className="btn-amber"
              style={{
                marginTop: 14,
                padding: "12px 22px",
                fontSize: 14,
                border: "none",
                cursor: "pointer",
              }}
            >
              {switching ? "Confirm in your wallet…" : "Switch to Base Sepolia"}
            </button>
            {switchError ? (
              <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--ink-72)" }}>
                {switchError.message.split("\n")[0]}. You may need to add Base Sepolia to your wallet
                first.
              </p>
            ) : null}
          </Card>
        ) : null}

        {/* --- Success: the plan was created ------------------------------ */}
        {originated ? (
          <Card style={{ border: "1px solid rgba(233,161,59,0.45)" }}>
            <Eyebrow>Plan created</Eyebrow>
            <div
              style={{
                marginTop: 8,
                fontFamily: "var(--font-source-serif)",
                fontSize: 25,
                letterSpacing: "-0.02em",
              }}
            >
              Merchant paid. Plan #{originated.planId} is live.
            </div>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-62)", lineHeight: 1.6 }}>
              Kudira paid <span className="num">{formatAmount(TOTAL)}</span> KUSDC to the merchant in
              full, and your {installments} weekly installments are now scheduled. You already
              approved the auto-debit, so there is nothing else to sign.
            </p>
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <a
                href={explorerTx(originated.txHash)}
                target="_blank"
                rel="noreferrer"
                className="btn-amber"
                style={{ padding: "12px 20px", fontSize: 14, textDecoration: "none" }}
              >
                View transaction ↗
              </a>
              <Link href="/account" style={{ fontSize: 14, color: "var(--ink-68)" }}>
                Go to account →
              </Link>
            </div>
            <div className="num" style={{ marginTop: 12, fontSize: 11.5, color: "var(--ink-55)" }} title={originated.txHash}>
              {shortAddress(originated.txHash, 8)}
            </div>
          </Card>
        ) : null}

        {/* --- Step 2: the credential read -------------------------------- */}
        {isConnected && !wrongChain && !originated ? (
          <Card>
            <Eyebrow>Step 2 of 3 · A-Pass read · validator compliance check</Eyebrow>
            {reading ? (
              <div style={{ marginTop: 14, fontSize: 14, color: "var(--ink-62)" }}>
                Reading your credential…
              </div>
            ) : apass?.found && apass.credential ? (
              <>
                <div style={{ marginTop: 12 }}>
                  <Eyebrow>Approved credit limit</Eyebrow>
                  <div style={{ marginTop: 8 }}>
                    <Amount value={available ?? 0n} unit="KUSDC" size="hero" />
                  </div>
                </div>

                <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                  <Row label="Credential" value={`A-Pass · ${apass.credential.status === 1 ? "active" : "inactive"}`} />
                  <Row
                    label="Standing"
                    value={
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <GradeBadge band={(band as string) ?? "—"} />
                        <span className="num">subTier {apass.credential.subTier}</span>
                      </span>
                    }
                  />
                  <Row label="Tier" value={<span className="num">{apass.credential.tier}</span>} />
                  <Row
                    label="Satisfies pool rule"
                    value={<span className="num">{String(apass.satisfiesPoolRule)}</span>}
                  />
                </div>

                {apass.disagreement ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: "var(--r-input)",
                      background: "var(--paper-sunk)",
                      border: "1px solid var(--ink-16)",
                      fontSize: 12.5,
                      color: "var(--ink-72)",
                    }}
                  >
                    {apass.disagreement}
                  </div>
                ) : null}

                <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink-55)", lineHeight: 1.6 }}>
                  Kudira read tier, standing and limit. No name, document or account number.
                </p>
              </>
            ) : (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: "var(--r-inner)",
                  background: "var(--paper-sunk)",
                  border: "1px solid var(--ink-10)",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>No A-Pass for this wallet</div>
                <p style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-62)", lineHeight: 1.6 }}>
                  {apass?.message ?? "This wallet holds no credential."} Without one there is nothing
                  to underwrite against, and the settlement token itself would refuse the transfer.
                </p>
              </div>
            )}
          </Card>
        ) : null}

        {/* --- Step 3: the plan, and the buyer's own signature ------------- */}
        {isConnected && !wrongChain && eligible && !originated ? (
          <Card>
            <Eyebrow>Step 3 of 3 · Your payment</Eyebrow>
            <div style={{ marginTop: 12 }}>
              <Amount value={PER} unit="KUSDC" size="large" />
              <span style={{ fontSize: 15, color: "var(--ink-62)", marginLeft: 8 }}>× {installments}</span>
            </div>

            {/* Installment selector. Shown only before approval, so the count is
                locked once the buyer signs. Default 4 leaves the schedule and the
                request unchanged. Segmented pill control (design TOKENS §3). */}
            {!hasAllowance ? (
              <div style={{ marginTop: 14 }}>
                <Eyebrow>Installments</Eyebrow>
                <div
                  role="radiogroup"
                  aria-label="Number of installments"
                  style={{
                    marginTop: 8,
                    display: "inline-flex",
                    gap: 4,
                    padding: 4,
                    background: "var(--paper-sunk)",
                    borderRadius: 999,
                  }}
                >
                  {[3, 4, 6].map((n) => {
                    const active = installments === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`${n} installments`}
                        onClick={() => setInstallments(n)}
                        className={active ? "btn-amber" : undefined}
                        style={{
                          minWidth: 54,
                          padding: "8px 18px",
                          borderRadius: 999,
                          border: "none",
                          background: active ? undefined : "transparent",
                          color: active ? undefined : "var(--ink-62)",
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <p style={{ marginTop: hasAllowance ? 8 : 14, fontSize: 13, color: "var(--ink-62)" }}>
              <span className="num">{formatAmount(TOTAL)}</span> total · every week · 0% interest
              {hasRemainder ? " · final installment settles the remainder" : null}
            </p>

            <div style={{ marginTop: 16 }}>
              <Eyebrow>Authorise auto-debit</Eyebrow>
              <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-62)", lineHeight: 1.6 }}>
                You approve the pool once, now. Each installment is then pulled on its due date. You
                sign this yourself — Kudira cannot move funds you have not approved.
              </p>

              {hasAllowance ? (
                <>
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: "var(--r-input)",
                      background: "var(--paper-amber)",
                      border: "1px solid rgba(233,161,59,0.35)",
                      fontSize: 13,
                    }}
                  >
                    Authorised. Allowance{" "}
                    <span className="num">{formatAmount(allowance as bigint)}</span> KUSDC.
                    {approveHash ? (
                      <>
                        {" "}
                        <a href={explorerTx(approveHash)} target="_blank" rel="noreferrer" className="num">
                          view tx
                        </a>
                      </>
                    ) : null}
                  </div>
                  <button
                    onClick={confirmPlan}
                    disabled={originating}
                    className="btn-amber"
                    style={{
                      marginTop: 12,
                      padding: "14px 24px",
                      fontSize: 15,
                      border: "none",
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    {originating ? "Creating plan…" : "Confirm and create plan"}
                  </button>
                  {originateError ? (
                    <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--ink-72)", lineHeight: 1.6 }}>
                      {originateError}
                    </p>
                  ) : null}
                </>
              ) : (
                <button
                  onClick={() =>
                    writeContract({
                      address: ADDRESSES.kusdc,
                      abi: erc20Abi,
                      functionName: "approve",
                      args: [ADDRESSES.pool, TOTAL],
                    })
                  }
                  disabled={approving || confirming}
                  className="btn-amber"
                  style={{
                    marginTop: 12,
                    padding: "14px 24px",
                    fontSize: 15,
                    border: "none",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  {approving
                    ? "Confirm in your wallet…"
                    : confirming
                      ? "Waiting for confirmation…"
                      : `Approve ${formatAmount(TOTAL)} KUSDC`}
                </button>
              )}

              {approveError ? (
                <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--ink-72)" }}>
                  {approveError.message.split("\n")[0]}
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {isConnected && !wrongChain && apass && !reading && !eligible && !originated ? (
          <Card>
            <Eyebrow>Not eligible</Eyebrow>
            <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-72)" }}>
              This wallet does not satisfy the pool&apos;s registered rule, so no plan can be
              originated against it. That check runs against Cleanverse, not against us.
            </p>
          </Card>
        ) : null}
      </div>

      {/* Sticky pay bar. GLASS — one of exactly two permitted uses. */}
      <div
        className="glass"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          borderTop: "1px solid var(--ink-08)",
          boxShadow: "var(--shadow-up)",
          padding: "14px 20px calc(14px + env(safe-area-inset-bottom))",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ fontSize: 12.5, color: "var(--ink-62)" }}>
            {originated
              ? "Plan created"
              : !isConnected
                ? "Connect to continue"
                : wrongChain
                  ? "Switch to Base Sepolia"
                  : !eligible
                    ? "Credential required"
                    : originating
                      ? "Creating plan…"
                      : hasAllowance
                        ? "Confirm to create the plan"
                        : "Approve to authorise auto-debit"}
          </div>
          <Link href="/account" style={{ fontSize: 13, color: "var(--ink-68)" }}>
            {formatGrade((band as string) ?? "")} · Account →
          </Link>
        </div>
      </div>
    </main>
  );
}

/// Map a refusal from /api/originate to a line the buyer can read. The server
/// never leaks internals; these are all business outcomes.
function originateReason(data: { reason?: string; errorName?: string; restValid?: boolean; chainValid?: boolean }): string {
  switch (data.reason) {
    case "no_apass":
      return "No A-Pass found for this wallet. There is nothing to underwrite against.";
    case "apass_inactive":
      return "This wallet's A-Pass is not active. It cannot be underwritten.";
    case "compliance_disagreement":
      return `The REST validator and the on-chain validator disagree about this wallet (REST ${String(data.restValid)}, on-chain ${String(data.chainValid)}). Refusing rather than guessing.`;
    case "not_compliant":
      return "This wallet does not satisfy the pool's registered rule.";
    case "allowance_too_low":
      return "Your approval does not cover the first installment. Approve again before confirming.";
    case "originate_reverts":
      switch (data.errorName) {
        case "ExceedsCreditLimit":
          return "This purchase is above your available credit limit.";
        case "InsufficientLiquidity":
          return "The pool does not currently hold enough liquidity for this plan.";
        case "BorrowerDelinquent":
          return "This wallet is delinquent and cannot open a new plan.";
        case "ApassRuleNotSatisfied":
          return "This wallet's tier does not satisfy the pool rule.";
        case "MerchantNotActive":
          return "The merchant is not active in the registry.";
        default:
          return "Origination would revert on-chain. Nothing was created.";
      }
    case "validator_unreachable":
    case "compliance_unreadable":
      return "The compliance check could not be completed. Try again in a moment.";
    case "broadcast_failed":
      return "The plan could not be broadcast. The operator may be out of gas. Try again.";
    default:
      return "Origination was refused. Nothing was created.";
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        paddingBottom: 10,
        borderBottom: "1px solid var(--ink-08)",
      }}
    >
      <span className="eyebrow">{label}</span>
      <span style={{ fontSize: 13.5, textAlign: "right" }}>{value}</span>
    </div>
  );
}
