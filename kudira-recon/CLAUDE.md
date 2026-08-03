# Kudira

Compliance-native buy now, pay later on the Cleanverse stack.
Cleanverse "Build: Trusted Assets" hackathon, DeFi track.
Submission due Aug 9, 23:59 UTC, by email to isaac@cleanverse.com.

**Read `ARCHITECTURE.md` before doing anything.** Every value in its section 0
was verified empirically against the live sandbox. It is not a plan, it is a
record of what is true.

---

## Hard rules

**Chain**
- Base Sepolia, chainId 84532. Never mainnet. The deploy script asserts this.
- Monad testnet (10143) is an optional bonus deploy only.

**aUSDC is credential-gated on BOTH sides of every transfer**
- `0xaC0893567D43C3E7e6e35a72803df05416C1f20D`, 6 decimals.
- Sender AND recipient each need an A-Pass. Five addresses in our money path do:
  liquidity provider, KudiraPool, merchant payout, borrower, treasury/withdrawal
  destination.
- Reverts `0xa6725971`, naming the offending party, **before the balance check**.
  A failing transfer never looks like insufficient balance.
- The ABI shows no sign of the gate. It lives in `_update` behind ERC-7201
  namespaced storage. Reading the interface gives a confident wrong answer.
- **Test against `MockAToken`, never a plain `MockERC20`.** An ungated mock lets
  every test pass while production reverts on its first transfer.

**Contracts**
- `KudiraPool` MUST be `Ownable` and expose `owner()`. Cleanverse
  `validator/grant` and `validator/register` verify an EIP-191 signature against
  it. Not retrofittable.
- `owner()` = governance and validator signature. `operator` = `originate` and
  `markDefault`. The operator must not be able to withdraw or change policy.
- Deploy satellites owned by the broadcaster, wire them, then transfer
  ownership. Deploying them owned by `POOL_OWNER` makes `setPool` revert
  mid-deploy for any cold or multisig owner.
- No plan may extend to or past the borrower's A-Pass `expirationTime`.

**Cleanverse API**
- Success is `code === "0000"`. Every response is HTTP 200. Never branch on HTTP
  status.
- `min_tier` and `min_sub_tier` are **strictly greater than**, not `>=`. `0`
  means unrestricted.
- `tier` is a **string** (`"50"`). `subTier` is an **integer**. aUSDC's
  `min_tier` is a **number**. Parse explicitly at every boundary.
- `query_apass` does not return `customerId` and cannot establish ownership. Use
  `query_apass_list`.
- `status` is `null` in the list endpoint. Use single `query_apass` for status.
- Undocumented error sub-codes exist. Parse the bracketed prefix from `message`,
  never string-match.
- Use `set_rule` for policy changes, not `add_rule`/`remove_rule` juggling.
  `add_rule` is create-only and rejects duplicates.
- Serialize on-chain writes. Wait for confirmation before the next mutation.

**Transport**
- Import `src/lib/tls-compat.js` first in every entrypoint. Node 24's OpenSSL 3.5
  offers `X25519MLKEM768` by default and the Cleanverse edge silently drops those
  ClientHellos.
- **Writes need HTTP/2** (`node:http2`). `generate_apass` mints on-chain and
  outlives the HTTP/1.1 timeout; the socket closes at ~15s and aborts before
  commit. Reads stay on `fetch`.

**Secrets**
- The AES api-key never leaves the server. `.env` only, gitignored. Never logged,
  never in a URL, never in a browser bundle.
- AES-256-CBC, PKCS#7, IV = 16 zero bytes, key =
  `Buffer.from(CLEANVERSE_API_KEY, "base64")`. Body is
  `{"data":"<Base64 ciphertext>"}`.

**Shared sandbox**
- Other teams read everything we write. **Synthetic data only.** No real names,
  no real ID numbers.
- customerIds prefixed `KUDIRA`, 12+ chars, `A-Za-z0-9` only. A raw UUID fails
  validation.
- Treat `override: true` as dangerous — cross-team customerId collision could
  clobber records.

**Verification discipline**
- **Never infer that a write succeeded from a record you did not create.** Match
  the exact customerId you generated, plus chain, plus wallet. An earlier proof
  produced a false positive by reading another team's records as its own.
- On-chain grade is canonical. A-Pass subTier is the published copy. Never
  overwrite an on-chain grade from an API read.
- Origination calls `validator/verify` as well as the on-chain `satisfiesRule`.
  Our contract mirrors Cleanverse's semantics and a mirror can drift. If they
  disagree, surface it loudly.

---

## Scope discipline

One merchant, one currency, one schedule shape. Depth of integration over breadth
of features. Anything that does not touch A-Pass, aUSDC or the Validator module
is cut without discussion.

Judging weights integration depth at 30 points, the largest single category.

---

## Working agreement

- Report failures plainly. A failed proof is a useful result; a false positive
  costs the build.
- Flag decisions made beyond the brief rather than burying them.
- Do not deploy, spend, or write to the sandbox outside an explicit instruction.
- Prefer complete files over diffs.
- No em dashes in generated prose.
