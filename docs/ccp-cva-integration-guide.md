# Cleanverse Compliance Protocol (CCP) - CVA Integration Guide

Source: "Cleanverse Compliance Protocol (CCP) CVA Integration Guide" PDF,
provided by Cleanverse. Saved here for version control. Excerpts and paraphrase;
the PDF is authoritative.

## What CVA and CCP are

**CVA = Cleanverse Verified Asset.** The native compliant-asset standard of the
**CCP = Cleanverse Compliance Protocol.** A CVA is a first-class ERC20 issued
directly on Cleanverse by qualified issuers. Every transfer is gated through
**CVI (Cleanverse Verified Identity)** compliance verification and the **RuleV2**
policy engine.

> "CVA is the native compliant asset standard of the Cleanverse Compliance
> Protocol (CCP). It is issued directly on Cleanverse by qualified issuers, and
> every transfer is gated through CVI compliance verification and the RuleV2
> policy engine."

### Key features

- Direct issuance: no pre-existing original ERC20 required.
- Built-in CVI compliance verification.
- Compliance policy based on RuleV2 (Group / Sub-Group / Tier / Sub-Tier /
  Country Bitmap).
- Supports Travel Rule reporting.
- Supports Pause / Resume and Whitelist operational controls.
- Two integration paths: API Launch and Custom Contract Template.
- Standard ERC20 + compliance hooks based on OpenZeppelin v5.

## RuleV2

The on-chain policy struct evaluated by the compliance engine. A token holds a
`RuleV2[]` evaluated under **OR** semantics (a user is compliant if they match
any one rule); fields within a single rule are **AND**.

```solidity
struct RuleV2 {
    bytes2  allowedGroup;      // Allowed CVI group     (0x0000 = unrestricted)
    bytes2  allowedSubGroup;   // Allowed CVI sub-group (0x0000 = unrestricted)
    uint8   minTier;           // Minimum CVI tier      (0 = unrestricted, 0-99)
    uint8   minSubTier;        // Minimum sub-tier       (0 = unrestricted, 0-99)
    uint256 poolCountryBitmap; // Country bitmap         (0 = unrestricted, bitwise AND)
}
```

**Migration note.** The legacy `is_black_list` + `countries` array is
consolidated into `poolCountryBitmap` (256-bit, bit positions = ISO 3166-1
numeric codes). `is_black_list` is a **deprecated field** - always pass `false`.
If the current API still exposes `countries`, pass ISO codes as a string array
and the platform handles compatibility.

API layer uses snake_case (`allowed_group`, `min_tier`, ...) aligning exactly
with the on-chain field names.

## Two integration paths

### Method A - Launch CVA via API

For issuers with existing backend infrastructure who do not want to maintain
contract code in-house. Cleanverse deploys the contract template uniformly and
policies are pushed via API.

1. Call the Launch CVA API - submit token config (`chain`, `token_name`,
   `token_symbol`, `decimals`, `admin_address`, `rule`) plus optional `icon` /
   `callback_url`. The `data` field is **AES/CBC/PKCS5** encrypted, Base64-encoded
   into the body, with `api-id` and `X-Request-ID` headers, `POST` to
   **`/api/cooperate/atoken/launch`**.
2. Cleanverse verification (token config, RuleV2 validity, business suitability,
   issuer qualification - CVA is open only to qualified issuers). Poll via the
   Query Apply Status API.
3. (Optional) Grant `MINTER_ROLE` - if a platform contract (e.g. AccessCore)
   must mint on your behalf, the Admin grants `MINTER_ROLE` on the CVA to it;
   otherwise your own `MINTER_ROLE` holder mints directly.

### Method B - Custom Contract Template

For full control over token logic. Deploy your own ERC20 that:

- Specifies the `policy` contract address at initialization.
- Calls `policy.canTransfer(token, from, to, amount)` inside `_update` before
  every transfer, reverting `TransferNotAllowed()` on failure.
- Implements `Ownable` / `AccessControl`, Mint/Burn, and RuleV2 self-management
  wrappers (`setRuleV2` / `addRuleV2` / `removeRuleV2` / `getRulesV2` routed to
  the policy's `*FromToken` entry points).

Then Register CVA API (`owner_signature` = EIP-191 personal_sign over
`lowercase(chain + atoken_address)`), Cleanverse verification, optional
`MINTER_ROLE`, and configure RuleV2 policies.

The `IATokenPolicy` interface (RuleV2-only view): `canTransfer`, `setRuleV2`,
`addRuleV2`, `removeRuleV2`, `setRuleV2FromToken`, `addRuleV2FromToken`,
`removeRuleV2FromToken`, `getRulesV2`.

Full API docs: https://docs.cleanverse.com/

---

## What this means for Kudira

- **KUSDC is a CVA** - a Cleanverse Verified Asset issued through the documented
  Method A path (`/atoken/launch`), not an improvised workaround. The facts do
  not change; the framing does. README, deck, and merchant UI vocabulary updated
  to say "CVA" / "Cleanverse Verified Asset".
- Our pool rule (`min_tier 5`, `min_sub_tier 0`, no country restriction) maps
  cleanly onto RuleV2 and is unaffected by the `poolCountryBitmap` migration
  (our country set is empty → zero bitmap → unrestricted).
