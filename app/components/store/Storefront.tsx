"use client";

import Link from "next/link";
import { useState } from "react";

import { Amount, Card, Eyebrow, Logo } from "@/components/brand/Primitives";
import { MERCHANT_NAME } from "@/lib/contracts";

/// Priced so a normal bag lands near the demo's 130 and stays well under the
/// borrower's available credit. The whole flow follows whatever total you build.
const PRODUCTS = [
  { id: "benguet", name: "Benguet washed, 340g", detail: "Single origin · medium roast", price: 78_000_000n, initial: 1 },
  { id: "sagada", name: "Sagada natural, 340g", detail: "Single origin · light roast", price: 52_000_000n, initial: 1 },
  { id: "barako", name: "Barako blend, 340g", detail: "Dark roast · robusta", price: 40_000_000n, initial: 0 },
] as const;

const INSTALLMENTS = 4n;

export function Storefront() {
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(PRODUCTS.map((p) => [p.id, p.initial])),
  );

  const total = PRODUCTS.reduce((acc, p) => acc + p.price * BigInt(qty[p.id] ?? 0), 0n);
  const perInstallment = total > 0n ? total / INSTALLMENTS : 0n;
  const empty = total === 0n;

  const setItem = (id: string, next: number) => setQty((q) => ({ ...q, [id]: Math.max(0, next) }));

  return (
    <main style={{ minHeight: "100vh", background: "var(--canvas)", color: "var(--bone)", paddingBottom: 140 }}>
      <header
        style={{
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--line-08)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="eyebrow" style={{ fontSize: 10 }}>MANILA · PH</div>
          <div style={{ fontFamily: "var(--font-instrument-serif), Georgia, serif", fontSize: 22, letterSpacing: "-0.01em", lineHeight: 1 }}>
            {MERCHANT_NAME}
          </div>
        </div>
        <Link href="/account" style={{ fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace", fontSize: 12, letterSpacing: "0.06em", color: "var(--bone-62)" }}>
          ACCOUNT →
        </Link>
      </header>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px", display: "grid", gap: 12 }}>
        <Card>
          <Eyebrow>Your bag</Eyebrow>
          <div style={{ marginTop: 14 }}>
            {PRODUCTS.map((item, i) => {
              const n = qty[item.id] ?? 0;
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 0",
                    borderTop: i === 0 ? "none" : "1px solid var(--line-08)",
                    opacity: n === 0 ? 0.55 : 1,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, color: "var(--bone)" }}>{item.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--bone-55)", marginTop: 3 }}>{item.detail}</div>
                    <div className="num" style={{ fontSize: 12.5, color: "var(--bone-62)", marginTop: 5 }}>
                      <Amount value={item.price} /> each
                    </div>
                  </div>
                  <Stepper value={n} onChange={(v) => setItem(item.id, v)} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <Eyebrow>Total</Eyebrow>
          <div style={{ marginTop: 12 }}>
            <Amount value={total} unit="KUSDC" size="hero" />
          </div>
          <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--bone-62)", lineHeight: 1.6 }}>
            4 payments of{" "}
            <span className="num">
              <Amount value={perInstallment} />
            </span>{" "}
            · no interest, no fees.
          </p>
          <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--bone-55)", lineHeight: 1.6 }}>
            {MERCHANT_NAME} is paid in full at checkout. Kudira carries the credit risk, underwritten
            against your A-Pass.
          </p>
        </Card>
      </div>

      {/* Sticky pay bar. Solid on the black canvas — a figure never sits on glass. */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          background: "var(--raised)",
          borderTop: "1px solid var(--line-14)",
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
            <div style={{ fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace", fontSize: 11, letterSpacing: "0.06em", color: "var(--bone-55)" }}>
              4 PAYMENTS OF
            </div>
            <div className="num" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 2 }}>
              <Amount value={perInstallment} unit="KUSDC" />
            </div>
          </div>
          {empty ? (
            <span className="btn-accent" aria-disabled style={{ padding: "14px 26px", fontSize: 14, display: "inline-block", opacity: 0.4, pointerEvents: "none" }}>
              Add an item
            </span>
          ) : (
            <Link href={`/checkout?amount=${total.toString()}`} className="btn-accent" style={{ padding: "14px 26px", fontSize: 14, display: "inline-block" }}>
              Pay with Kudira
            </Link>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", top: 16, right: 20, zIndex: 50, opacity: 0.9 }}>
        <Logo size={13} />
      </div>
    </main>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const btn: React.CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: 9,
    border: "1px solid var(--line-14)",
    background: "var(--raised-2)",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    color: "var(--bone)",
    fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
      <button type="button" aria-label="decrease" onClick={() => onChange(value - 1)} disabled={value === 0} style={{ ...btn, opacity: value === 0 ? 0.35 : 1 }}>
        −
      </button>
      <span className="num" style={{ minWidth: 16, textAlign: "center", fontSize: 15 }}>
        {value}
      </span>
      <button type="button" aria-label="increase" onClick={() => onChange(value + 1)} style={btn}>
        +
      </button>
    </div>
  );
}
