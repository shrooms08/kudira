// TLS compatibility shim for uatapi.cleanverse.com.
//
// Node 24 ships OpenSSL 3.5, whose default TLS 1.3 group list leads with the
// post-quantum hybrid X25519MLKEM768. That key share inflates the ClientHello
// past one MTU, and the Cleanverse edge silently drops the fragmented hello —
// TCP connects, the handshake then hangs until timeout (UND_ERR_CONNECT_TIMEOUT).
//
// Restricting the offered groups to classical curves keeps the ClientHello small
// and still negotiates TLS 1.3. This is a pure side-effect module: import it
// FIRST in every entrypoint, before anything opens a socket.
//
// Verified: with this set, 10/10 consecutive calls to the live sandbox succeed.
// Without it, every call times out. See the TLS diagnosis for the full trace.

import tls from "node:tls";

tls.DEFAULT_ECDH_CURVE = "X25519:prime256v1";
