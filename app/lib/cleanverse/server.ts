import "server-only";

// Cleanverse sandbox client. SERVER ONLY — importing this from a client
// component is a build error, which is the point: CLEANVERSE_API_KEY is the AES
// key for write bodies and must never reach a browser bundle.
//
// Two operational constraints, both learned the hard way and both non-negotiable:
//
//   TLS   Node 24 / OpenSSL 3.5 offers the post-quantum group X25519MLKEM768 by
//         default. The Cleanverse edge silently drops those ClientHellos: TCP
//         connects, then the handshake times out. Pinning classical curves fixes
//         it and still negotiates TLS 1.3.
//
//   HTTP/2  Write endpoints mint on-chain and outlive the HTTP/1.1 idle window;
//         the server closes the socket at ~15s and aborts before commit. Node's
//         global fetch is HTTP/1.1 only, so writes go over node:http2.

import http2 from "node:http2";
import { createCipheriv, createDecipheriv } from "node:crypto";
import tls from "node:tls";

tls.DEFAULT_ECDH_CURVE = "X25519:prime256v1";

const ORIGIN = "https://uatapi.cleanverse.com";
const BASE_PATH = "/api/cooperate";

export const CHAIN = "base";

function apiId(): string {
  const v = process.env.CLEANVERSE_API_ID;
  if (!v) throw new Error("CLEANVERSE_API_ID is not set");
  return v;
}

function aesKey(): Buffer {
  const raw = process.env.CLEANVERSE_API_KEY;
  if (!raw) throw new Error("CLEANVERSE_API_KEY is not set");
  const key = Buffer.from(raw, "base64");
  // Report the length, never the bytes.
  if (key.length !== 32) throw new Error(`CLEANVERSE_API_KEY must decode to 32 bytes; got ${key.length}`);
  return key;
}

/// AES-256-CBC, PKCS#7, IV = 16 zero bytes. The sandbox's convention.
export function encryptBody(obj: unknown): string {
  const cipher = createCipheriv("aes-256-cbc", aesKey(), Buffer.alloc(16, 0));
  return Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj), "utf8")), cipher.final()]).toString(
    "base64",
  );
}

export function decryptBody<T = unknown>(b64: string): T {
  const d = createDecipheriv("aes-256-cbc", aesKey(), Buffer.alloc(16, 0));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]).toString("utf8"));
}

export type ApiResult<T = unknown> = {
  ok: boolean;
  /// Cleanverse envelope code. Success is "0000" — NEVER branch on HTTP status.
  code?: string;
  message?: string;
  data?: T;
  raw?: unknown;
  error?: string;
};

function normalise<T>(body: Record<string, unknown> | undefined, error?: string): ApiResult<T> {
  if (error) return { ok: false, error };
  const code = body?.code as string | undefined;
  return {
    ok: code === "0000",
    code,
    message: body?.message as string | undefined,
    data: body?.data as T,
    raw: body,
  };
}

/// Reads: plain fetch is fine.
export async function read<T = unknown>(
  path: string,
  body: unknown,
  timeoutMs = 20_000,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ORIGIN}${BASE_PATH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-id": apiId() },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    try {
      return normalise<T>(JSON.parse(text));
    } catch {
      return { ok: false, error: `non-JSON response: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string }; message?: string };
    return { ok: false, error: e.name === "AbortError" ? "timeout" : (e.cause?.code ?? e.message ?? "failed") };
  } finally {
    clearTimeout(timer);
  }
}

/// Writes: HTTP/2, so the connection survives the on-chain mint.
export function write<T = unknown>(path: string, body: unknown, timeoutMs = 60_000): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ data: encryptBody(body) });
    const client = http2.connect(ORIGIN);
    let settled = false;
    const done = (r: ApiResult<T>) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        /* already closing */
      }
      resolve(r);
    };
    client.on("error", (e) => done({ ok: false, error: String(e?.message ?? e) }));

    const req = client.request({
      ":method": "POST",
      ":path": `${BASE_PATH}${path}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      "api-id": apiId(),
    });
    req.setTimeout(timeoutMs, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      done({ ok: false, error: "timeout" });
    });

    let text = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      try {
        done(normalise<T>(JSON.parse(text)));
      } catch {
        done({ ok: false, error: `non-JSON response: ${text.slice(0, 200)}` });
      }
    });
    req.on("error", (e) => done({ ok: false, error: String(e?.message ?? e) }));
    req.end(payload);
  });
}

// --- Typed calls the app actually makes ---------------------------------------

export type ApassRecord = {
  tier: string; // STRING, e.g. "50"
  subTier: number; // INTEGER
  status: number | null;
  expirationTime: number;
  countries: string[];
  currentKycHash: string;
  cvRecordId: string;
  group: string;
  subGroup: string;
};

/// Standing for one wallet. Note query_apass does NOT return customerId and so
/// can never establish ownership — use query_apass_list for that.
export const queryApass = (address: string) =>
  read<ApassRecord>("/query_apass", { chain: CHAIN, address });

/// Does this wallet satisfy an A-Token's transfer rule? data.code 4 = allowed.
/// NOTE the parameter is `atoken` here, but `atoken_address` on /atoken/rules.
export const verifyApass = (address: string, atoken: string) =>
  read<{ code: number; message: string; address: string; atoken: string }>("/verify_apass", {
    chain: CHAIN,
    atoken,
    address,
  });

/// Does this wallet satisfy OUR registered validator pool rule?
/// The parameter is `user_address`, not `address`.
export const validatorVerify = (userAddress: string, poolAddress: string) =>
  read<{ valid: boolean; user_address: string; contract_address: string }>("/validator/verify", {
    chain: CHAIN,
    contract_address: poolAddress,
    user_address: userAddress,
  });

export const isRegisteredPool = (poolAddress: string) =>
  read<{ registered: boolean }>("/validator/is_register", {
    chain: CHAIN,
    contract_address: poolAddress,
  });

export const atokenRules = (atokenAddress: string) =>
  read<{ rules: Array<Record<string, unknown>> }>("/atoken/rules", {
    chain: CHAIN,
    atoken_address: atokenAddress,
  });

/// Travel Rule report for a transfer.
/// `wallet` is an OBJECT, `txHash` is camelCase. Both discovered by probing —
/// a string `wallet` fails at JSON binding with a bare 400.
export const downloadTravelRule = (walletAddress: string, txHash: string) =>
  read<unknown>("/download_travel_rule", {
    chain: CHAIN,
    wallet: { address: walletAddress, chain: CHAIN },
    txHash,
  });
