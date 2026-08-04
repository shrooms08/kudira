# Cleanverse Compliance Protocol (CCP) - CVI Compliance Validator Integration Guide (V2)

Source: "Cleanverse Compliance Protocol (CCP) Integration Guide (For CVI
Compliance Validator) V2" PDF, provided by Cleanverse. Saved here for version
control. Excerpts and paraphrase; the PDF is authoritative.

## Overview

The **CVI Compliance Validator** (`IAPassComplianceValidator`) provides on-chain
identity compliance verification based on **CVI (Cleanverse Verified Identity)**
for DeFi protocols. It is the on-chain contract behind the Validator module.

> "The CVI Compliance Validator (IAPassComplianceValidator) provides on-chain
> identity compliance verification based on CVI for DeFi protocols."

What it does:

- Verify whether a user's CVI satisfies the compliance rules configured for a
  pool (Group / Tier / Sub-Group / Sub-Tier / country bitmap).
- Manage per-pool compliance rules (multiple rules per pool, OR logic).
- Register CVI for CVA vaults (Pool + Fee) so they can hold / transfer CVAs.
- Pause pools or freeze accounts (emergency risk control).

## Core interface

RuleV2 struct is identical to the CVA guide. Validation logic: fields within a
single RuleV2 are **AND**; multiple RuleV2s are **OR**; country bitmaps checked
via bitwise AND.

```solidity
// Registration (REGISTER_ROLE)
function registerV2(address poolAddress, RuleV2 calldata rule) external;
function registerApass(address poolAddress, address aTokenAddress) external;
function registerApass(address poolAddress, address aTokenAddress, address feeAddress) external;
function setRuleV2FromRegistrar(address poolAddress, RuleV2 calldata rule) external;
function isRegistered(address poolAddress) external view returns (bool);

// Rule management (business contract itself)
function setRuleV2FromContract(RuleV2 calldata rule) external;
function addRuleV2FromContract(RuleV2 calldata rule) external;
function removeRuleV2FromContract(uint256 index) external;
function getRulesV2(address poolAddress) external view returns (RuleV2[] memory);

// Compliance verification - NO PERMISSION REQUIRED
function complianceVerify(address poolAddress, address userAddress) external view returns (bool);
```

`complianceVerify(pool, user)` is the read-only gate. Selector
`0xaf375463`. It is marked "No Permission Required" - any caller can read it.

## Two integration patterns

### Pattern 1 - Factory mode

For multi-pool businesses (DEX, Launch Pool). A Factory holding `REGISTER_ROLE`
calls `registerV2` / `registerApass` directly when creating pools. Authorization
API: `POST /api/cooperate/validator/apply`.

- **Integration Method A (Using CVA):** compliance checks are performed
  automatically by the CVA contract inside its `_update` (calls
  `validator.complianceVerify(address(this), from)` and `...to`). The business
  contract does not call the validator explicitly. After registering the pool,
  call `registerApass(pool, token, fee)` to issue CVI for the Pool (+ Fee)
  address. `registerApass` can only be called by the Factory; a fee address of
  `address(0)` skips Fee CVI registration.
- **Integration Method B (Calling the validator directly):** when CVA is not
  used, the business contract calls `complianceVerify` at key business steps.

### Pattern 2 - Single-Contract mode

No Factory authorization required. Deploy the contract, register it via the API,
then set rules and call `complianceVerify` at key business steps.

> **Listed use cases, in order:** "Lending protocols: verify borrower CVI to
> filter compliant borrowers" (first), NFT minting, staking pools, governance
> voting.

The `CompliantLending` template calls `validator.complianceVerify(address(this),
msg.sender)` inside `deposit()`, `borrow()` and `withdraw()`, reverting
"A-Pass not qualified" on failure.

**API registration:** `POST /api/cooperate/validator/register`. Signature rule:
`keccak256(chain + contract_address)`, lowercase hex concatenation. The API
registration only binds the contract address; compliance checks are performed by
the business contract via internal calls to the validator.

Rule management methods and their behaviour:

| Method | Behaviour |
|---|---|
| `setRuleV2FromContract(rule)` | Replace all rules |
| `addRuleV2FromContract(rule)` | Append a rule (OR logic) |
| `removeRuleV2FromContract(index)` | Remove a rule by index |
| `getRulesV2()` | Query the rule list |

Access control: business contracts should enforce `onlyOwner` / `AccessControl`
on rule-management methods.

---

## What this means for Kudira

- **CCP is load-bearing for us.** The Validator module we already integrate
  (`validator/grant`, `validator/register`, `validator/set_rule`,
  `validator/verify`) is exactly CCP's `IAPassComplianceValidator` interface.
  KudiraPool is a Pattern-2 single-contract lending integration - the doc's
  first-listed use case, almost verbatim: "verify borrower CVI to filter
  compliant borrowers."
- Our origination path checks both the on-chain `satisfiesRule` (our mirror) and
  the Cleanverse `validator/verify` API (the source of truth). The on-chain
  equivalent of that API check is `complianceVerify(pool, user)` on the validator
  contract.
### Validator contract address on Base Sepolia (resolved)

**`IAPassComplianceValidator` = `0xaC7e5179C2C7f03f209136886c172eb34F161792`**

Never given to us directly; recovered from our own registration transaction
`0x607475d38a3b956c2af19e897abb6643960ebe0c106a4e9951e6a6d4c5900944` (README),
whose `to` is the validator. That tx was sent by Cleanverse's REGISTER_ROLE
wallet `0xBd8428761efB5384C4945d16de56817Caa6903dF` and emitted two events with
our pool `0x4a89…199e` as topic1 (registration + rule-set carrying `min_tier 5`).

Verified read-only (`cast call`, Base Sepolia, no permission required):

| Call | Result |
|---|---|
| `isRegistered(0x4a89…199e)` | `true` |
| `getRulesV2(0x4a89…199e)` | `[(0x0000, 0x0000, 5, 0, 0)]` - minTier 5, all else unrestricted |
| `complianceVerify(pool, borrower 0x0918…8afd)` | `true` (A-Pass tier 50 > 5) |
| `complianceVerify(pool, merchant 0xE8D7…e06D)` | `true` |
| `complianceVerify(pool, 0x…dEaD)` | `false` (uncredentialed) |

This is the on-chain twin of the `validator/verify` API result: same rule, same
answer, readable by anyone. Other known Cleanverse contracts: AccessCore
`0x8F118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC`, A-Pass registry
`0xbA82D189540CaC9DC6FF46B6837CaC1BFdEC58B9`.
