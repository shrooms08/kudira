// Transport helpers for the Cleanverse sandbox.
//
// Reads go over plain fetch. WRITES MUST GO OVER HTTP/2: generate_apass mints
// on-chain and outlives the HTTP/1.1 idle window, and the server closes the h1.1
// socket at ~15s, aborting the mint before it commits. Node's global fetch is
// HTTP/1.1 only, so writes use node:http2.
//
// Import ./tls-compat.js before anything here opens a socket.

import http2 from "node:http2";

export const ORIGIN = "https://uatapi.cleanverse.com";
export const BASE_PATH = "/api/cooperate";
export const BASE_URL = `${ORIGIN}${BASE_PATH}`;

/// Read path: plain fetch. Returns { httpStatus, body } or { error }.
export async function post(url, body, headers = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    try {
      return { httpStatus: res.status, body: JSON.parse(text) };
    } catch {
      return { httpStatus: res.status, body: { _raw: text } };
    }
  } catch (err) {
    return { error: err?.name === "AbortError" ? "timeout" : String(err?.cause?.code ?? err.message) };
  } finally {
    clearTimeout(timer);
  }
}

/// Write path: HTTP/2, so the connection survives the on-chain mint.
export function h2Post(path, body, headers = {}, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const client = http2.connect(ORIGIN);
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        /* already closing */
      }
      resolve(r);
    };
    client.on("error", (err) => done({ error: String(err?.code ?? err?.message ?? err) }));

    const req = client.request({
      ":method": "POST",
      ":path": `${BASE_PATH}${path}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      ...headers,
    });
    req.setTimeout(timeoutMs, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      done({ error: "timeout" });
    });

    let status = null;
    let text = "";
    req.on("response", (h) => (status = h[":status"]));
    req.setEncoding("utf8");
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      try {
        done({ httpStatus: status, body: JSON.parse(text) });
      } catch {
        done({ httpStatus: status, body: { _raw: text } });
      }
    });
    req.on("error", (err) => done({ error: String(err?.code ?? err?.message ?? err) }));
    req.end(payload);
  });
}
