import Link from "next/link";

import { Amount, Card, Eyebrow, Logo } from "@/components/brand/Primitives";
import { MERCHANT_NAME } from "@/lib/contracts";

export const metadata = { title: "Manila Coffee Roasters" };

/// The bag. 130.00 total, which is the purchase the whole demo follows.
const BAG = [
  { name: "Benguet washed, 340g", detail: "Single origin · medium roast", price: 78_000_000n },
  { name: "Sagada natural, 340g", detail: "Single origin · light roast", price: 52_000_000n },
];

export default function Storefront() {
  const total = BAG.reduce((acc, i) => acc + i.price, 0n);
  const perInstallment = total / 4n;

  return (
    <main style={{ minHeight: "100vh", background: "var(--paper)", paddingBottom: 132 }}>
      <header
        style={{
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--ink-08)",
        }}
      >
        <div style={{ fontFamily: "var(--font-source-serif)", fontSize: 17, fontWeight: 600 }}>
          {MERCHANT_NAME}
        </div>
        <Link href="/account" style={{ fontSize: 13, color: "var(--ink-62)" }}>
          Account
        </Link>
      </header>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px", display: "grid", gap: 12 }}>
        <Card>
          <Eyebrow>Your bag</Eyebrow>
          <div style={{ marginTop: 14 }}>
            {BAG.map((item, i) => (
              <div
                key={item.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--ink-08)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      background: "var(--paper-sunk)",
                    }}
                  />
                  <div>
                    <div style={{ fontSize: 14 }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-55)", marginTop: 2 }}>
                      {item.detail}
                    </div>
                  </div>
                </div>
                <span className="num" style={{ fontSize: 14 }}>
                  <Amount value={item.price} />
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <Eyebrow>Due today</Eyebrow>
          <div style={{ marginTop: 12 }}>
            <Amount value={perInstallment} unit="KUSDC" size="hero" />
          </div>
          <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--ink-68)", lineHeight: 1.6 }}>
            <span className="num">
              <Amount value={total} />
            </span>{" "}
            total, split into 4 payments. No interest, no fees.
          </p>
          <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-55)", lineHeight: 1.6 }}>
            {MERCHANT_NAME} is paid in full today. Kudira carries the credit risk, underwritten
            against your A-Pass.
          </p>
        </Card>

        <Card>
          <Eyebrow>From other buyers</Eyebrow>
          <p
            style={{
              marginTop: 12,
              fontFamily: "var(--font-source-serif)",
              fontSize: 19,
              lineHeight: 1.5,
              letterSpacing: "-0.015em",
            }}
          >
            &ldquo;Paying in four made a 130 order easy. The standing going up after each payment is
            oddly satisfying.&rdquo;
          </p>
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-55)" }}>
            Verified buyer · Manila
          </div>
        </Card>
      </div>

      {/* Sticky pay bar. GLASS — one of exactly two permitted uses. No number
          sits behind the blur: the amount is on the opaque card above. */}
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
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-62)" }}>4 payments of</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>
              <Amount value={perInstallment} unit="KUSDC" />
            </div>
          </div>
          <Link
            href="/checkout"
            className="btn-amber"
            style={{ padding: "14px 28px", fontSize: 15, display: "inline-block" }}
          >
            Pay with Kudira
          </Link>
        </div>
      </div>

      <div
        style={{
          position: "fixed",
          top: 12,
          right: 16,
          zIndex: 50,
          fontSize: 11,
          color: "var(--ink-45)",
        }}
      >
        <Logo size={13} />
      </div>
    </main>
  );
}
