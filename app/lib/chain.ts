import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

import {
  ADDRESSES,
  creditLineAbi,
  erc20Abi,
  plansAbi,
  poolAbi,
  registryAbi,
  RPC_URL,
  validatorAbi,
} from "./contracts";

/**
 * Read-only client. Server components use this directly; writes go through the
 * user's own wallet (buyer approve) or an operator API route.
 *
 * `batch: { multicall: true }` makes viem coalesce concurrent `readContract`
 * calls into a single Multicall3 `aggregate3` request. Every page below issues
 * its reads concurrently, so a dashboard that would otherwise be a dozen
 * sequential round trips lands in one. That matters twice over: the public Base
 * Sepolia endpoint has rate-limited us before, and sequential latency is visible
 * on camera.
 */
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL, { batch: true }),
  batch: {
    multicall: { wait: 8 },
  },
});

const plansContract = { address: ADDRESSES.plans, abi: plansAbi } as const;
const creditContract = { address: ADDRESSES.creditLine, abi: creditLineAbi } as const;
const poolContract = { address: ADDRESSES.pool, abi: poolAbi } as const;
const registryContract = { address: ADDRESSES.registry, abi: registryAbi } as const;
const kusdcContract = { address: ADDRESSES.kusdc, abi: erc20Abi } as const;
const validatorContract = { address: ADDRESSES.ccpValidator, abi: validatorAbi } as const;

export type RuleV2 = {
  allowedGroup: `0x${string}`;
  allowedSubGroup: `0x${string}`;
  minTier: number;
  minSubTier: number;
  poolCountryBitmap: bigint;
};

/**
 * The on-chain twin of `validator/verify`, read straight from Cleanverse's own
 * CCP validator (`ADDRESSES.ccpValidator`). For each wallet, `complianceVerify`
 * answers exactly what the REST endpoint answers; the merchant panel puts the two
 * side by side and shouts if they ever diverge.
 *
 * Also pulls `isRegistered(pool)` and the stored `getRulesV2(pool)` so the panel
 * can show our rule living in the validator, not just assert it. One multicall.
 */
export async function getComplianceOnChain(addresses: `0x${string}`[]): Promise<{
  registered: boolean;
  rules: RuleV2[];
  verify: Record<string, boolean>;
}> {
  // Issued concurrently; the publicClient's multicall batch transport coalesces
  // them into a single Multicall3 aggregate3 request at the RPC layer.
  const [registered, rules, ...verdicts] = await Promise.all([
    publicClient.readContract({ ...validatorContract, functionName: "isRegistered", args: [ADDRESSES.pool] }),
    publicClient.readContract({ ...validatorContract, functionName: "getRulesV2", args: [ADDRESSES.pool] }),
    ...addresses.map((a) =>
      publicClient.readContract({ ...validatorContract, functionName: "complianceVerify", args: [ADDRESSES.pool, a] }),
    ),
  ]);

  const verify: Record<string, boolean> = {};
  addresses.forEach((a, i) => {
    verify[a.toLowerCase()] = verdicts[i] as boolean;
  });
  return { registered: registered as boolean, rules: (rules as RuleV2[]) ?? [], verify };
}

export type Plan = {
  id: number;
  borrower: `0x${string}`;
  merchant: `0x${string}`;
  principal: bigint;
  amountPaid: bigint;
  installments: number;
  startTime: bigint;
  dueEvery: bigint;
  apassExpirationTime: bigint;
  gracePeriod: bigint;
  everLate: boolean;
  status: number;
  // derived
  outstanding: bigint;
  installmentAmount: bigint;
  installmentsCovered: number;
  nextDueDate: bigint;
  amountDueNow: bigint;
  isLate: boolean;
};

/**
 * Every plan, with its derived state.
 *
 * There is no on-chain enumeration by borrower — deliberately, to avoid a
 * storage write per origination. planCount is small, so iterate and filter. If
 * this ever needs to scale, that is the moment for an indexer, not for an array
 * in the contract.
 *
 * All reads for all plans go out in ONE multicall: 7 calls per plan issued
 * together rather than 7 sequential round trips each.
 */
export async function getAllPlans(): Promise<Plan[]> {
  const count = await publicClient.readContract({ ...plansContract, functionName: "planCount" });
  const n = Number(count);
  if (n === 0) return [];

  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));

  const contracts = ids.flatMap((planId) => [
    { ...plansContract, functionName: "getPlan", args: [planId] } as const,
    { ...plansContract, functionName: "outstandingOf", args: [planId] } as const,
    { ...plansContract, functionName: "installmentAmount", args: [planId] } as const,
    { ...plansContract, functionName: "installmentsCovered", args: [planId] } as const,
    { ...plansContract, functionName: "nextDueDate", args: [planId] } as const,
    { ...plansContract, functionName: "amountDueNow", args: [planId] } as const,
    { ...plansContract, functionName: "isLate", args: [planId] } as const,
  ]);

  const results = await publicClient.multicall({ contracts, allowFailure: false });

  const PER_PLAN = 7;
  return ids.map((planId, i) => {
    const base = i * PER_PLAN;
    const p = results[base] as {
      borrower: `0x${string}`;
      merchant: `0x${string}`;
      principal: bigint;
      amountPaid: bigint;
      installments: number;
      startTime: bigint;
      dueEvery: bigint;
      apassExpirationTime: bigint;
      gracePeriod: bigint;
      everLate: boolean;
      status: number;
    };
    return {
      id: Number(planId),
      borrower: p.borrower,
      merchant: p.merchant,
      principal: p.principal,
      amountPaid: p.amountPaid,
      installments: p.installments,
      startTime: p.startTime,
      dueEvery: p.dueEvery,
      apassExpirationTime: p.apassExpirationTime,
      gracePeriod: p.gracePeriod,
      everLate: p.everLate,
      status: p.status,
      outstanding: results[base + 1] as bigint,
      installmentAmount: results[base + 2] as bigint,
      installmentsCovered: Number(results[base + 3]),
      nextDueDate: results[base + 4] as bigint,
      amountDueNow: results[base + 5] as bigint,
      isLate: results[base + 6] as boolean,
    };
  });
}

export async function loadPlan(planId: bigint): Promise<Plan> {
  const all = await getAllPlans();
  const found = all.find((p) => p.id === Number(planId));
  if (!found) throw new Error(`plan ${planId} not found`);
  return found;
}

/// Due dates for every installment of a plan, in one multicall.
export async function getDueDates(planId: bigint, installments: number): Promise<bigint[]> {
  const contracts = Array.from({ length: installments }, (_, i) => ({
    ...plansContract,
    functionName: "dueDateOf" as const,
    args: [planId, i + 1] as const,
  }));
  return (await publicClient.multicall({ contracts, allowFailure: false })) as bigint[];
}

export type Standing = {
  exists: boolean;
  grade: number;
  band: string;
  limit: bigint;
  available: bigint;
  outstanding: bigint;
  completedPlans: number;
  defaults: number;
  delinquent: boolean;
  balance: bigint;
};

/// Ten reads, one multicall.
export async function getStanding(address: `0x${string}`): Promise<Standing> {
  const [exists, grade, band, limit, available, outstanding, completed, defaults, delinquent, balance] =
    await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { ...creditContract, functionName: "exists", args: [address] },
        { ...creditContract, functionName: "gradeOf", args: [address] },
        { ...creditContract, functionName: "bandOf", args: [address] },
        { ...creditContract, functionName: "limitOf", args: [address] },
        { ...creditContract, functionName: "availableCredit", args: [address] },
        { ...creditContract, functionName: "outstandingOf", args: [address] },
        { ...creditContract, functionName: "completedPlansOf", args: [address] },
        { ...creditContract, functionName: "defaultsOf", args: [address] },
        { ...creditContract, functionName: "isDelinquent", args: [address] },
        { ...kusdcContract, functionName: "balanceOf", args: [address] },
      ],
    });

  return {
    exists: exists as boolean,
    grade: Number(grade),
    band: band as string,
    limit: limit as bigint,
    available: available as bigint,
    outstanding: outstanding as bigint,
    completedPlans: Number(completed),
    defaults: Number(defaults),
    delinquent: delinquent as boolean,
    balance: balance as bigint,
  };
}

export type PoolInfo = {
  owner: `0x${string}`;
  operator: `0x${string}`;
  asset: `0x${string}`;
  minTier: number;
  minSubTier: number;
  liquidity: bigint;
};

export async function getPoolInfo(): Promise<PoolInfo> {
  const [owner, operator, asset, minTier, minSubTier, liquidity] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { ...poolContract, functionName: "owner" },
      { ...poolContract, functionName: "operator" },
      { ...poolContract, functionName: "asset" },
      { ...poolContract, functionName: "minTier" },
      { ...poolContract, functionName: "minSubTier" },
      { ...poolContract, functionName: "liquidity" },
    ],
  });
  return {
    owner: owner as `0x${string}`,
    operator: operator as `0x${string}`,
    asset: asset as `0x${string}`,
    minTier: Number(minTier),
    minSubTier: Number(minSubTier),
    liquidity: liquidity as bigint,
  };
}

export type MerchantStatus = {
  registered: boolean;
  active: boolean;
  payout: `0x${string}` | null;
  registryOwner: `0x${string}`;
  received: bigint;
};

/// `payoutOf` REVERTS for an unregistered merchant, so this uses
/// allowFailure and treats a failed payout read as "no payout yet" rather than
/// letting one expected revert take down the whole page.
export async function getMerchantStatus(merchant: `0x${string}`): Promise<MerchantStatus> {
  const [registered, active, owner, payout, received] = await publicClient.multicall({
    allowFailure: true,
    contracts: [
      { ...registryContract, functionName: "isRegistered", args: [merchant] },
      { ...registryContract, functionName: "isActive", args: [merchant] },
      { ...registryContract, functionName: "owner" },
      { ...registryContract, functionName: "payoutOf", args: [merchant] },
      { ...kusdcContract, functionName: "balanceOf", args: [merchant] },
    ],
  });

  return {
    registered: registered.status === "success" ? (registered.result as boolean) : false,
    active: active.status === "success" ? (active.result as boolean) : false,
    registryOwner: (owner.status === "success" ? owner.result : "0x") as `0x${string}`,
    payout: payout.status === "success" ? (payout.result as `0x${string}`) : null,
    received: received.status === "success" ? (received.result as bigint) : 0n,
  };
}
