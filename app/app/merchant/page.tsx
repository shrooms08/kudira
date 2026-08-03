import {
  TravelRulePanel,
  TravelRuleReference,
  ValidatorVerifyPanel,
} from "@/components/merchant/CompliancePanels";
import { Amount, Card, Eyebrow, Logo } from "@/components/brand/Primitives";
import { getAllPlans, getMerchantStatus, getPoolInfo } from "@/lib/chain";
import { ACTORS, ADDRESSES, MERCHANT_NAME, PLAN_STATUS } from "@/lib/contracts";
import { explorerAddress, explorerTx, formatAmount, shortAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

/// The origination that settled this merchant's first plan. Used as the subject
/// of the Travel Rule request.
const SETTLEMENT_TX = "0x1aeb97fe1b0fae0f0bb6bdce5eb7460e6813655641e4b842dc5902660504e3f6";

export default async function MerchantDashboard() {
  // Three concurrent groups; viem coalesces them into multicalls.
  const [plans, pool, merchant] = await Promise.all([
    getAllPlans(),
    getPoolInfo(),
    getMerchantStatus(ACTORS.merchant),
  ]);
  const received = merchant.received;

  const mine = plans.filter((p) => p.merchant.toLowerCase() === ACTORS.merchant.toLowerCase());
  const active = mine.filter((p) => p.status === 1).length;
  const settled = mine.filter((p) => p.status === 2).length;
  // Settled-to-you is every plan's principal: the merchant is paid in full at
  // origination, so a plan later completing or defaulting does not change what
  // they received.
  const settledToYou = mine.reduce((acc, p) => acc + p.principal, 0n);

  return (
    <main style={{ minHeight: "100vh", background: "var(--paper)" }}>
      <header
        style={{
          borderBottom: "1px solid var(--ink-08)",
          background: "var(--white)",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Logo />
          <nav style={{ display: "flex", gap: 20, fontSize: 13.5, color: "var(--ink-62)" }}>
            <span style={{ color: "var(--ink)" }}>Overview</span>
            <span>Settlements</span>
            <span>Compliance</span>
          </nav>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-62)" }}>
          {MERCHANT_NAME} · <span className="num">SG/PH</span>
        </div>
      </header>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 80px" }}>
        <Eyebrow>Merchant dashboard</Eyebrow>
        <h1
          style={{
            fontFamily: "var(--font-source-serif)",
            fontSize: 34,
            letterSpacing: "-0.02em",
            marginTop: 8,
            fontWeight: 600,
          }}
        >
          {MERCHANT_NAME}
        </h1>

        {/* --- Stats ------------------------------------------------------ */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 24 }}>
          <Card>
            <Eyebrow>Settled to you</Eyebrow>
            <div style={{ marginTop: 10 }}>
              <Amount value={settledToYou} unit="KUSDC" size="large" />
            </div>
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--ink-62)", lineHeight: 1.5 }}>
              Paid in full at checkout · 0 chargebacks
            </p>
          </Card>
          <Card>
            <Eyebrow>Plans</Eyebrow>
            <div className="num" style={{ marginTop: 10, fontSize: 34, letterSpacing: "-0.04em" }}>
              {active}
              <span style={{ fontSize: 17, color: "var(--ink-45)" }}> / {mine.length}</span>
            </div>
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--ink-62)", lineHeight: 1.5 }}>
              {active} repaying, {settled} settled. Buyer credit risk sits with Kudira, not with you.
            </p>
          </Card>
          <Card>
            <Eyebrow>Settlement</Eyebrow>
            <div style={{ marginTop: 10, fontSize: 27, letterSpacing: "-0.02em", fontWeight: 600 }}>
              Same tx
            </div>
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--ink-62)", lineHeight: 1.5 }}>
              The payout is emitted inside the origination transaction, not queued after it.
            </p>
          </Card>
        </div>

        {/* --- Onboarding: TWO steps, TWO different keys ------------------- */}
        <div style={{ marginTop: 12 }}>
          <Card>
            <Eyebrow>Merchant onboarding</Eyebrow>
            <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-72)" }}>
              Being paid takes two separate approvals. A Cleanverse credential lets this address{" "}
              <em>hold</em> the settlement asset. Registry activation lets the pool <em>pay</em> it.
              One without the other fails at origination.
            </p>
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <OnboardStep
                label="Cleanverse credential"
                value="A-Pass issued · verify_apass code 4"
                sub="Without it the settlement token itself reverts NoAPass, before any balance check."
                ok
              />
              <OnboardStep
                label="Registry activation"
                value={merchant.active ? "Registered and active" : "Not active"}
                sub={`register() is onlyOwner — signed by ${shortAddress(merchant.registryOwner)}. originate() is onlyOperator, a different key. The operator can create debt but cannot add a payee.`}
                ok={merchant.active}
              />
            </div>
            <div className="num" style={{ marginTop: 12, fontSize: 11.5, color: "var(--ink-45)" }}>
              payout {merchant.payout ? shortAddress(merchant.payout, 6) : "—"}
            </div>
          </Card>
        </div>

        {/* --- Settlements ------------------------------------------------- */}
        <div style={{ marginTop: 12 }}>
          <Card>
            <Eyebrow>Settlements</Eyebrow>
            <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-62)" }}>
              Buyers are pseudonymous. Kudira never discloses identity to merchants.
            </p>
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr auto",
                  gap: 12,
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--ink-08)",
                }}
              >
                {["Buyer", "Plan", "Progress", "Amount"].map((h) => (
                  <span key={h} className="eyebrow">
                    {h}
                  </span>
                ))}
              </div>
              {mine.length === 0 ? (
                <p style={{ padding: "16px 0", fontSize: 13, color: "var(--ink-55)" }}>
                  No settlements yet.
                </p>
              ) : (
                mine.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr auto",
                      gap: 12,
                      alignItems: "center",
                      padding: "12px 0",
                      borderBottom: "1px solid var(--ink-08)",
                      fontSize: 13.5,
                    }}
                  >
                    <span className="num" style={{ color: "var(--ink-72)" }}>
                      {shortAddress(p.borrower)}
                    </span>
                    <span className="num" style={{ color: "var(--ink-62)" }}>
                      KU-{String(p.id).padStart(4, "0")}
                    </span>
                    <span style={{ color: "var(--ink-62)" }}>
                      <span className="num">
                        {p.installmentsCovered} of {p.installments}
                      </span>{" "}
                      paid · {PLAN_STATUS[p.status]}
                    </span>
                    <span className="num" style={{ textAlign: "right" }}>
                      {formatAmount(p.principal)}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="num" style={{ marginTop: 12, fontSize: 11.5, color: "var(--ink-45)" }}>
              settled via this pool {formatAmount(settledToYou)} KUSDC · wallet holds{" "}
              {formatAmount(received)}, which includes earlier rehearsal runs
            </div>
          </Card>
        </div>

        {/* --- Compliance -------------------------------------------------- */}
        <div style={{ marginTop: 28 }}>
          <Eyebrow>Compliance</Eyebrow>
          <h2
            style={{
              fontFamily: "var(--font-source-serif)",
              fontSize: 27,
              letterSpacing: "-0.02em",
              marginTop: 8,
              fontWeight: 600,
            }}
          >
            What works, where it ends, and why
          </h2>
          <p style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-68)" }}>
            Both panels call the live Cleanverse sandbox when you press the button. Neither is
            mocked, including the one that fails.
          </p>
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <ValidatorVerifyPanel />
          <TravelRulePanel txHash={SETTLEMENT_TX} />
          <TravelRuleReference amount={130_000_000n} />
        </div>

        {/* --- Footer facts ------------------------------------------------ */}
        <div style={{ marginTop: 28, fontSize: 11.5, lineHeight: 1.8, color: "var(--ink-45)" }} className="num">
          <div>
            pool{" "}
            <a href={explorerAddress(ADDRESSES.pool)} target="_blank" rel="noreferrer">
              {ADDRESSES.pool}
            </a>
          </div>
          <div>
            settlement asset {ADDRESSES.kusdc} · rule min_tier {pool.minTier} / min_sub_tier{" "}
            {pool.minSubTier}
          </div>
          <div>
            settlement tx{" "}
            <a href={explorerTx(SETTLEMENT_TX)} target="_blank" rel="noreferrer">
              {shortAddress(SETTLEMENT_TX, 8)}
            </a>{" "}
            · Base Sepolia 84532
          </div>
        </div>
      </div>
    </main>
  );
}

function OnboardStep({
  label,
  value,
  sub,
  ok,
}: {
  label: string;
  value: string;
  sub: string;
  ok: boolean;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: "var(--r-inner)",
        background: ok ? "var(--paper-amber)" : "var(--paper-sunk)",
        border: `1px solid ${ok ? "rgba(233,161,59,0.35)" : "var(--ink-10)"}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, color: ok ? "var(--amber-ink)" : "var(--ink-62)" }}>{value}</span>
      </div>
      <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-62)" }}>{sub}</p>
    </div>
  );
}
