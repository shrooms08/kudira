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
                    borderTop: i === 0 ? "none" : "1px solid var(--ink-08)",
                    opacity: n === 0 ? 0.62 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 14, background: "var(--paper-sunk)", flex: "none" }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14 }}>{item.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-55)", marginTop: 2 }}>{item.detail}</div>
                      <div className="num" style={{ fontSize: 12, color: "var(--ink-62)", marginTop: 4 }}>
                        <Amount value={item.price} /> each
                      </div>
                    </div>
                  </div>
                  <Stepper value={n} onChange={(v) => setItem(item.id, v)} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <Eyebrow>First payment</Eyebrow>
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
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-62)" }}>4 payments of</div>
            <div className="num" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>
              <Amount value={perInstallment} unit="KUSDC" />
            </div>
          </div>
          {empty ? (
            <span
              className="btn-amber"
              aria-disabled
              style={{ padding: "14px 28px", fontSize: 15, display: "inline-block", opacity: 0.5, pointerEvents: "none" }}
            >
              Add an item
            </span>
          ) : (
            <Link
              href={`/checkout?amount=${total.toString()}`}
              className="btn-amber"
              style={{ padding: "14px 28px", fontSize: 15, display: "inline-block" }}
            >
              Pay with Kudira
            </Link>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", top: 12, right: 16, zIndex: 50, fontSize: 11, color: "var(--ink-45)" }}>
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
    border: "1px solid var(--ink-16)",
    background: "var(--paper)",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    color: "var(--ink)",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
      <button type="button" aria-label="decrease" onClick={() => onChange(value - 1)} disabled={value === 0} style={{ ...btn, opacity: value === 0 ? 0.4 : 1 }}>
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
