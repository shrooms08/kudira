import Link from "next/link";

import { LadderTable, NextPayment, PlanList, StandingCard } from "@/components/account/AccountViews";
import { Logo } from "@/components/brand/Primitives";
import { getAllPlans, getStanding } from "@/lib/chain";
import { ACTORS, ADDRESSES } from "@/lib/contracts";
import { explorerAddress, formatAmount, shortAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

/// The buyer whose wallet the demo runs against. In a real deployment this comes
/// from the connected wallet; the checkout flow will read it from wagmi.
const BUYER = ACTORS.borrower;

export default async function AccountPage() {
  const [standing, allPlans] = await Promise.all([getStanding(BUYER), getAllPlans()]);
  const mine = allPlans.filter((p) => p.borrower.toLowerCase() === BUYER.toLowerCase());
  const active = mine.filter((p) => p.status === 1);
  const history = mine.filter((p) => p.status !== 1);

  return (
    <main style={{ minHeight: "100vh", background: "var(--paper)", paddingBottom: 110 }}>
      {/* Top bar. Normal flow, so it scrolls away with the content. The grade
          badge lives in the Standing card below, not here, so it is shown once. */}
      <header style={{ padding: "16px 20px" }}>
        <Logo />
      </header>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "8px 20px", display: "grid", gap: 12 }}>
        <NextPayment plans={mine} />
        <StandingCard standing={standing} />
        <PlanList plans={active} title="Active plans" />
        <LadderTable grade={standing.grade} />
        <PlanList plans={history} title="History" />

        {/* Credential + wallet facts */}
        <div
          style={{
            marginTop: 4,
            fontSize: 11.5,
            lineHeight: 1.8,
            color: "var(--ink-45)",
          }}
          className="num"
        >
          <div>
            wallet{" "}
            <a href={explorerAddress(BUYER)} target="_blank" rel="noreferrer" title={BUYER}>
              {shortAddress(BUYER, 6)}
            </a>{" "}
            · balance {formatAmount(standing.balance)} KUSDC
          </div>
          <div>
            <span title={ADDRESSES.creditLine}>credit line {shortAddress(ADDRESSES.creditLine, 6)}</span> · Base Sepolia 84532
          </div>
        </div>
      </div>

      {/* Floating bottom nav. GLASS — one of exactly two permitted uses. */}
      <nav
        className="glass"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          margin: "0 16px 16px",
          borderRadius: "var(--r-card)",
          border: "1px solid var(--ink-08)",
          boxShadow: "var(--shadow-up)",
          padding: "12px 8px",
          display: "flex",
          justifyContent: "space-around",
          maxWidth: 448,
          marginInline: "auto",
        }}
      >
        <NavItem href="/account" label="Plans" active />
        <NavItem href="/" label="Shop" />
        <NavItem href="/merchant" label="Merchant" />
      </nav>
    </main>
  );
}

function NavItem({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      style={{
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        color: active ? "var(--ink)" : "var(--ink-55)",
        padding: "4px 14px",
      }}
    >
      {label}
    </Link>
  );
}

