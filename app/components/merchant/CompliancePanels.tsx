"use client";

import { useState } from "react";

import { Amount, Card, Eyebrow, RawJson } from "@/components/brand/Primitives";
import { shortAddress } from "@/lib/format";

type TravelRuleResult = {
  request: unknown;
  response: unknown;
  ok: boolean;
  code: string | null;
  subCode: string | null;
  message: string | null;
  diagnosis: { headline: string; detail: string; proof: string | null } | null;
};

/**
 * Travel Rule panel — a REAL call to the live endpoint.
 *
 * When it fails we render the actual response next to the reason. A live failure
 * with a correct explanation is unfakeable; a mocked PDF is not.
 */
export function TravelRulePanel({ txHash }: { txHash: string }) {
  const [result, setResult] = useState<TravelRuleResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/compliance/travel-rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Eyebrow>Travel Rule record</Eyebrow>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ fontFamily: "var(--font-source-serif)", fontSize: 21, letterSpacing: "-0.02em" }}>
          Settlement {shortAddress(txHash, 6)}
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="btn-amber"
          style={{ padding: "9px 18px", fontSize: 13, border: "none", cursor: "pointer" }}
        >
          {loading ? "Requesting…" : result ? "Request again" : "Request record"}
        </button>
      </div>

      <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-62)", lineHeight: 1.6 }}>
        Calls <span className="num">POST /download_travel_rule</span> against the live Cleanverse
        sandbox. Nothing here is mocked.
      </p>

      {result ? (
        <div style={{ marginTop: 18 }}>
          {result.ok ? (
            <div
              style={{
                padding: 14,
                borderRadius: "var(--r-inner)",
                background: "var(--paper-amber)",
                border: "1px solid rgba(233,161,59,0.35)",
                fontSize: 14,
              }}
            >
              Report generated. See the raw response below for the download URL.
            </div>
          ) : (
            <div
              style={{
                padding: 16,
                borderRadius: "var(--r-inner)",
                background: "var(--paper-sunk)",
                border: "1px solid var(--ink-10)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="num" style={{ fontSize: 11, color: "var(--ink-62)" }}>
                  {result.subCode ?? result.code}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  {result.diagnosis?.headline ?? "Report not available"}
                </span>
              </div>
              {result.diagnosis ? (
                <>
                  <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-72)" }}>
                    {result.diagnosis.detail}
                  </p>
                  {result.diagnosis.proof ? (
                    <p
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: "1px solid var(--ink-08)",
                        fontSize: 12.5,
                        lineHeight: 1.7,
                        color: "var(--ink-62)",
                      }}
                    >
                      <strong style={{ color: "var(--ink-82)" }}>How we know: </strong>
                      {result.diagnosis.proof}
                    </p>
                  ) : null}
                </>
              ) : (
                <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-72)" }}>{result.message}</p>
              )}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <Eyebrow>Request</Eyebrow>
            <div style={{ marginTop: 6 }}>
              <RawJson value={result.request} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <Eyebrow>Response, verbatim</Eyebrow>
            <div style={{ marginTop: 6 }}>
              <RawJson value={result.response} />
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

type VerifyResult = {
  pool: string;
  atoken: string;
  checkedAt: string;
  results: Array<{
    label: string;
    address: string;
    note: string;
    valid: boolean | null;
    validatorRaw: unknown;
    tokenCode: number | null;
    tokenMessage: string | null;
  }>;
};

/**
 * The compliance check that DOES work. Calls validator/verify live against our
 * registered pool rule, for a credentialed wallet and for one generated at
 * request time. The fresh wallet is what makes it unfakeable — it cannot have
 * been prepared in advance.
 */
export function ValidatorVerifyPanel() {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/compliance/validator-verify", { method: "POST" });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Eyebrow>Compliance check — live</Eyebrow>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ fontFamily: "var(--font-source-serif)", fontSize: 21, letterSpacing: "-0.02em" }}>
          Validator rule
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="btn-amber"
          style={{ padding: "9px 18px", fontSize: 13, border: "none", cursor: "pointer" }}
        >
          {loading ? "Checking…" : result ? "Check again" : "Run check"}
        </button>
      </div>

      <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-62)", lineHeight: 1.6 }}>
        Calls <span className="num">POST /validator/verify</span> against our registered pool. The
        second wallet is generated at the moment you press the button.
      </p>

      {result ? (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {result.results.map((r) => (
            <div
              key={r.address}
              style={{
                padding: 14,
                borderRadius: "var(--r-inner)",
                background: r.valid ? "var(--paper-amber)" : "var(--paper-sunk)",
                border: `1px solid ${r.valid ? "rgba(233,161,59,0.35)" : "var(--ink-10)"}`,
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{r.label}</div>
                  <div className="num" style={{ fontSize: 11.5, color: "var(--ink-55)", marginTop: 2 }}>
                    {r.address}
                  </div>
                </div>
                <div
                  className="num"
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: r.valid ? "var(--amber-ink)" : "var(--ink-62)",
                    whiteSpace: "nowrap",
                  }}
                >
                  valid: {String(r.valid)}
                </div>
              </div>
              {r.note ? (
                <p style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-62)" }}>
                  {r.note}
                </p>
              ) : null}
              <div className="num" style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink-55)" }}>
                token rule: code {r.tokenCode ?? "—"} · {r.tokenMessage}
              </div>
            </div>
          ))}
          <div className="num" style={{ fontSize: 11, color: "var(--ink-45)" }}>
            checked {result.checkedAt}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/// Reference rendering of what a Travel Rule record contains when the asset IS
/// inside Cleanverse's settlement index. Clearly marked so it is never mistaken
/// for live data.
export function TravelRuleReference({ amount }: { amount: bigint }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Amount", <Amount key="a" value={amount} unit="aUSDC" />],
    [
      "Timestamp",
      <span key="t" className="num">
        2026-08-03T14:05:22Z
      </span>,
    ],
    ["Originating institution", "Kudira (Issue Member)"],
    ["Originator", "Attested, not disclosed"],
    ["Beneficiary", "Manila Coffee Roasters"],
    [
      "Integrity",
      <span key="i" className="num">
        SHA-256 over the report body
      </span>,
    ],
  ];
  return (
    <Card style={{ background: "var(--paper-sunk)", boxShadow: "none", border: "1px dashed var(--ink-16)" }}>
      <Eyebrow>Reference — not live data</Eyebrow>
      <p style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-62)" }}>
        The shape of the record this returns when settlement is in aUSDC. Shown from the design, not
        from the API, because our settlement asset is outside the index.
      </p>
      <div style={{ marginTop: 14, display: "grid", gap: 0 }}>
        {rows.map(([label, value], i) => (
          <div
            key={String(label)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              padding: "10px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--ink-08)",
            }}
          >
            <span className="eyebrow" style={{ color: "var(--ink-55)" }}>
              {label}
            </span>
            <span style={{ fontSize: 13.5, textAlign: "right" }}>{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
