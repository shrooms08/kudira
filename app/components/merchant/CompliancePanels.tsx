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
        <div style={{ fontFamily: "var(--font-instrument-serif)", fontSize: 21, letterSpacing: "-0.02em" }}>
          Settlement {shortAddress(txHash, 6)}
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="btn-accent"
          style={{ padding: "9px 18px", fontSize: 13, border: "none", cursor: "pointer" }}
        >
          {loading ? "Requesting…" : result ? "Request again" : "Request record"}
        </button>
      </div>

      <p style={{ marginTop: 8, fontSize: 13, color: "var(--bone-62)", lineHeight: 1.6 }}>
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
                background: "var(--signal-14)",
                border: "1px solid rgba(0,208,132,0.35)",
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
                background: "var(--raised-2)",
                border: "1px solid var(--line-09)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="num" style={{ fontSize: 11, color: "var(--bone-62)" }}>
                  {result.subCode ?? result.code}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  {result.diagnosis?.headline ?? "Report not available"}
                </span>
              </div>
              {result.diagnosis ? (
                <>
                  <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.7, color: "var(--bone-75)" }}>
                    {result.diagnosis.detail}
                  </p>
                  {result.diagnosis.proof ? (
                    <p
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: "1px solid var(--line-08)",
                        fontSize: 12.5,
                        lineHeight: 1.7,
                        color: "var(--bone-62)",
                      }}
                    >
                      <strong style={{ color: "var(--bone-75)" }}>How we know: </strong>
                      {result.diagnosis.proof}
                    </p>
                  ) : null}
                </>
              ) : (
                <p style={{ marginTop: 8, fontSize: 13, color: "var(--bone-75)" }}>{result.message}</p>
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

type RuleV2Json = {
  allowedGroup: string;
  allowedSubGroup: string;
  minTier: number;
  minSubTier: number;
  poolCountryBitmap: string;
};

type VerifyResult = {
  pool: string;
  atoken: string;
  validator: string;
  checkedAt: string;
  onChain: { registered: boolean; rules: RuleV2Json[] };
  anyDisagreement: boolean;
  results: Array<{
    label: string;
    address: string;
    note: string;
    restValid: boolean | null;
    chainValid: boolean | null;
    agree: boolean | null;
    validatorRaw: unknown;
    tokenCode: number | null;
    tokenMessage: string | null;
  }>;
};

function ruleTuple(r: RuleV2Json): string {
  return `(${r.allowedGroup}, ${r.allowedSubGroup}, ${r.minTier}, ${r.minSubTier}, ${r.poolCountryBitmap})`;
}

/// One wallet's verdict, the REST answer and the on-chain answer side by side.
function Verdict({ label, value }: { label: string; value: boolean | null }) {
  const text = value === null ? "—" : String(value);
  const on = value === true;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="eyebrow" style={{ fontSize: "clamp(8px, 2.4vw, 9.5px)", color: "var(--bone-42)", whiteSpace: "nowrap" }}>
        {label}
      </div>
      <div
        className="num"
        style={{
          marginTop: 3,
          fontSize: "clamp(12px, 3.6vw, 14px)",
          fontWeight: 600,
          color: on ? "var(--signal)" : "var(--bone-62)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * Compliance, checked two independent ways for the same wallets: the live
 * `validator/verify` REST endpoint, and `complianceVerify(pool, wallet)` read
 * straight from Cleanverse's CCP validator contract. Each is labelled. If the two
 * ever disagree the panel says so loudly instead of trusting either — that
 * divergence is the whole point. The fresh wallet, generated at request time, is
 * what makes the false case unfakeable.
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
      <Eyebrow>CCP compliance check — live</Eyebrow>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ fontFamily: "var(--font-instrument-serif)", fontSize: 21, letterSpacing: "-0.02em" }}>
          Compliance Protocol rule
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="btn-accent"
          style={{ padding: "9px 18px", fontSize: 13, border: "none", cursor: "pointer" }}
        >
          {loading ? "Checking…" : result ? "Check again" : "Run check"}
        </button>
      </div>

      <p style={{ marginTop: 8, fontSize: 13, color: "var(--bone-62)", lineHeight: 1.6 }}>
        Two independent answers to the same question, for each wallet:{" "}
        <span className="num">POST /validator/verify</span> (REST) and{" "}
        <span className="num">complianceVerify(pool, wallet)</span> read from the CCP validator at{" "}
        <span className="num">{shortAddress("0xaC7e5179C2C7f03f209136886c172eb34F161792", 6)}</span>{" "}
        (on-chain). They should always agree. The second wallet is generated at the moment you press
        the button.
      </p>

      {result ? (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {/* The rule, stored on-chain in Cleanverse's own validator. Stronger
              than any claim we could make about it. */}
          <div
            style={{
              padding: 14,
              borderRadius: "var(--r-inner)",
              background: "var(--raised-2)",
              border: "1px solid var(--line-09)",
            }}
          >
            <Eyebrow>Our rule, stored on-chain</Eyebrow>
            <div className="num" style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.7 }}>
              <div style={{ color: "var(--bone-55)" }}>
                getRulesV2(pool) →{" "}
                {result.onChain.rules.length ? (
                  result.onChain.rules.map((r, i) => (
                    <span key={i} style={{ color: "var(--bone)" }}>
                      {ruleTuple(r)}
                    </span>
                  ))
                ) : (
                  <span>[]</span>
                )}
              </div>
              <div style={{ marginTop: 4, color: "var(--bone-42)" }}>
                (allowedGroup, allowedSubGroup, minTier, minSubTier, poolCountryBitmap) · isRegistered:{" "}
                {String(result.onChain.registered)}
              </div>
            </div>
          </div>

          {/* Loud banner: REST and chain diverged. */}
          {result.anyDisagreement ? (
            <div
              style={{
                padding: 14,
                borderRadius: "var(--r-inner)",
                background: "rgba(255,107,74,0.1)",
                border: "1px solid var(--warn)",
                color: "var(--bone)",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700 }}>REST and on-chain DISAGREE</div>
              <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.6 }}>
                The API and Cleanverse&apos;s validator contract returned different verdicts for a
                wallet below. Neither is treated as authoritative. This is the case worth
                investigating, not smoothing over.
              </p>
            </div>
          ) : null}

          {result.results.map((r, i) => {
            const disagree = r.agree === false;
            const both = r.restValid === true && r.chainValid === true;
            return (
              <div
                key={`${r.address}-${result.checkedAt}`}
                className="ku-stagger"
                style={{
                  animationDelay: `${i * 120}ms`,
                  padding: 14,
                  borderRadius: "var(--r-inner)",
                  background: disagree ? "rgba(255,107,74,0.1)" : both ? "var(--signal-14)" : "var(--raised-2)",
                  border: `1px solid ${
                    disagree ? "var(--warn)" : both ? "rgba(0,208,132,0.35)" : "var(--line-09)"
                  }`,
                  color: disagree ? "var(--bone)" : undefined,
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{r.label}</div>
                    <div
                      className="num"
                      style={{
                        fontSize: 11.5,
                        color: disagree ? "var(--bone-62)" : "var(--bone-55)",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.address}
                    </div>
                  </div>
                  {disagree ? (
                    <div className="num" style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                      MISMATCH
                    </div>
                  ) : null}
                </div>

                {/* REST vs on-chain stay side by side at every width — the whole
                    point is the two independent checks visible at a glance. The
                    methods (validator/verify, complianceVerify) are named in the
                    intro copy; the verdict labels stay short so they never stack. */}
                <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                  <Verdict label="REST" value={r.restValid} />
                  <Verdict label="on-chain" value={r.chainValid} />
                </div>

                {r.note ? (
                  <p
                    style={{
                      marginTop: 10,
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      color: disagree ? "var(--bone)" : "var(--bone-62)",
                    }}
                  >
                    {r.note}
                  </p>
                ) : null}
                <div
                  className="num"
                  style={{ marginTop: 8, fontSize: 11.5, color: disagree ? "var(--bone-62)" : "var(--bone-55)" }}
                >
                  token rule: code {r.tokenCode ?? "—"} · {r.tokenMessage}
                </div>
              </div>
            );
          })}
          <div className="num" style={{ fontSize: 11, color: "var(--bone-42)" }}>
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
    <Card style={{ background: "var(--raised-2)", boxShadow: "none", border: "1px dashed var(--line-14)" }}>
      <Eyebrow>Reference — not live data</Eyebrow>
      <p style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.6, color: "var(--bone-62)" }}>
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
              borderTop: i === 0 ? "none" : "1px solid var(--line-08)",
            }}
          >
            <span className="eyebrow" style={{ color: "var(--bone-55)" }}>
              {label}
            </span>
            <span style={{ fontSize: 13.5, textAlign: "right" }}>{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
