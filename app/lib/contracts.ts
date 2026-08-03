// Live Base Sepolia deployment (v4 — the one carrying grace + auto-debit).
//
// KudiraPool.asset is immutable, so the settlement token is fixed per
// deployment. This one settles in KUSDC.

export const CHAIN_ID = 84532; // Base Sepolia
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

export const ADDRESSES = {
  pool: "0x4a898781AFAd85BE7103126952BcBbFCCC24199e",
  registry: "0x05e2A2473e710435484f6B3b288677618E95bB15",
  creditLine: "0x49cD6c00EC00116Eed598b8e07f1B0D7A4805cBE",
  plans: "0xb4c055e7e880A684F9276435BDc12d25577d39D8",
  /// Our own A-Token. See README "Settlement asset".
  kusdc: "0x036BCFeB3cfE93dfc47f5A935D7f663b99ACAb1E",
  /// aUSDC — what Cleanverse's settlement flow indexes. We hold none.
  ausdc: "0xaC0893567D43C3E7e6e35a72803df05416C1f20D",
} as const;

export const ACTORS = {
  owner: "0x021Fed3a7d7367B3d4Da7812B38355014AFc808F",
  operator: "0x0c9CE1fcd01C997A51442bB296FfC960C59bEfdd",
  merchant: "0xE8D7b7CEDC7b114D56E7828C7179c6a9b9EEe06D",
  borrower: "0x09187143dDcbD329133a25f15B3913D2cEc88afd",
} as const;

export const MERCHANT_NAME = "Manila Coffee Roasters";

// --- ABIs (only what the UI actually calls) -----------------------------------

export const creditLineAbi = [
  { type: "function", name: "gradeOf", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "bandOf", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "string" }] },
  { type: "function", name: "gradeBand", stateMutability: "pure", inputs: [{ name: "grade", type: "uint8" }], outputs: [{ type: "string" }] },
  { type: "function", name: "limitOf", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "limitForGrade", stateMutability: "pure", inputs: [{ name: "grade", type: "uint8" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "availableCredit", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "outstandingOf", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "completedPlansOf", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "defaultsOf", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "isDelinquent", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "exists", stateMutability: "view", inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "GRADE_STEP_UP", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "GRADE_STEP_DOWN", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "DELINQUENT_THRESHOLD", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "LIMIT_PER_GRADE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const planStructAbi = {
  type: "tuple",
  components: [
    { name: "borrower", type: "address" },
    { name: "merchant", type: "address" },
    { name: "principal", type: "uint256" },
    { name: "amountPaid", type: "uint256" },
    { name: "installments", type: "uint16" },
    { name: "startTime", type: "uint64" },
    { name: "dueEvery", type: "uint64" },
    { name: "apassExpirationTime", type: "uint64" },
    { name: "gracePeriod", type: "uint64" },
    { name: "everLate", type: "bool" },
    { name: "status", type: "uint8" },
  ],
} as const;

export const plansAbi = [
  { type: "function", name: "planCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getPlan", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [planStructAbi] },
  { type: "function", name: "statusOf", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "amountDueNow", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "outstandingOf", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nextDueDate", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "dueDateOf", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }, { name: "index", type: "uint16" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "installmentAmount", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "installmentsCovered", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint16" }] },
  { type: "function", name: "installmentsElapsed", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint16" }] },
  { type: "function", name: "isLate", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "wasEverLate", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "gracePeriodOf", stateMutability: "view", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "graceFor", stateMutability: "pure", inputs: [{ name: "dueEvery", type: "uint64" }], outputs: [{ type: "uint64" }] },
] as const;

export const poolAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "minTier", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "minSubTier", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "satisfiesRule", stateMutability: "view", inputs: [{ name: "tier", type: "uint8" }, { name: "subTier", type: "uint8" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "collect", stateMutability: "nonpayable", inputs: [{ name: "planId", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export const registryAbi = [
  { type: "function", name: "isRegistered", stateMutability: "view", inputs: [{ name: "merchant", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ name: "merchant", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "payoutOf", stateMutability: "view", inputs: [{ name: "merchant", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/// Plan.status
export const PLAN_STATUS = ["None", "Active", "Completed", "Defaulted"] as const;
