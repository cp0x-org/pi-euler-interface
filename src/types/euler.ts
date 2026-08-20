// Types mirroring the Euler app API payloads (app.euler.finance/api/internal/*).
// Only the fields this interface reads are typed; payloads carry more.

export interface EulerChain {
  chainId: number;
  name: string;
  viemName: string;
  status: 'production' | 'staging' | string;
}

export interface EulerToken {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
}

export interface EulerTokenList {
  tokens: EulerToken[];
}

// labels/{chainId}/products.json — keyed by product slug
export interface EulerProduct {
  name: string;
  description: string;
  entity: string[] | string; // some products carry a single entity slug as a string
  url: string;
  vaults: string[];
  recentlyAdded?: boolean;
  tags?: string[];
  notExplorable?: boolean;
  deprecationReason?: string;
  vaultOverrides?: Record<
    string,
    {
      name?: string;
      description?: string;
      tags?: string[];
      notExplorableLend?: boolean;
    }
  >;
}

export type EulerProducts = Record<string, EulerProduct>;

// labels/{chainId}/entities.json — keyed by entity slug
export interface EulerEntity {
  name: string;
  logo?: string;
  description?: string;
  url?: string;
  addresses?: Record<string, string>;
}

export type EulerEntities = Record<string, EulerEntity>;

// labels/{chainId}/earn-vaults.json — strings are shorthand for an address,
// while object entries may add display metadata or deprecation state.
export interface EulerEarnVaultLabel {
  address: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  deprecationReason?: string;
  notExplorable?: boolean;
}

// BigInt values are serialized as { __bi: string }
export interface BigIntValue {
  __bi: string;
}

export interface EvkVaultAsset {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface EvkVaultCollateral {
  address: string;
  borrowLTV: number;
  liquidationLTV: number;
}

export interface EvkVaultData {
  type: string;
  chainId: number;
  address: string;
  shares: EvkVaultAsset;
  asset: EvkVaultAsset;
  totalShares: BigIntValue;
  totalAssets: BigIntValue;
  totalCash: BigIntValue;
  totalBorrowed: BigIntValue;
  marketPriceUsd: number;
  interestRates?: {
    borrowSPY: number;
    borrowAPY: number; // percent, e.g. 1.47 = 1.47%
    supplyAPY: number; // percent
  };
  collaterals?: EvkVaultCollateral[];
}

export interface EulerVaultsResponse {
  chainId: number;
  fetchedAt: number;
  evkVaults: { kind: string; data: EvkVaultData }[];
}

// v3.euler.finance — official public API (CORS-open, no key required)

// Collateral entry from POST /v3/evk/vaults/batch with include:["collaterals"]
export interface V3Collateral {
  collateral: string; // collateral vault address
  vaultType: string;
  collateralName: string;
  collateralSymbol: string;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  borrowLTV: string; // basis points, e.g. "8200" = 0.82
  liquidationLTV: string;
  currentLiquidationLTV?: string;
  initialLiquidationLTV?: string;
  targetTimestamp?: string;
  rampDuration?: number;
  oraclePriceRaw?: {
    queryFailure: boolean;
    queryFailureReason?: string;
    amountIn?: string;
    amountOutMid?: string;
    amountOutBid?: string;
    amountOutAsk?: string;
    timestamp?: string;
  };
}

export interface V3VaultCaps {
  supplyCap: string;
  borrowCap: string;
}

export interface V3VaultFees {
  interestFee: number;
  accumulatedFeesShares?: string;
  accumulatedFeesAssets?: string;
  governorFeeReceiver?: string;
  protocolFeeReceiver?: string;
  protocolFeeShare?: number;
}

export interface V3VaultHooks {
  hookedOperations: Record<string, boolean>;
  hookTarget: string;
}

export interface V3VaultLiquidation {
  maxLiquidationDiscount: number;
  liquidationCoolOffTime?: number;
  socializeDebt: boolean;
}

export interface V3InterestRateModel {
  address: string;
  type: string;
  data?: Record<string, unknown> | null;
}

export interface V3OracleInfo {
  oracle: string;
  name?: string;
  detailedInfo?: {
    oracle?: string;
    name?: string;
    resolvedAdapters?: Array<{
      oracle: string;
      name?: string;
      base?: string;
      quote?: string;
    }>;
    resolvedVaults?: Array<{
      vault: string;
      quote?: string;
      asset?: string;
      resolvedAssets?: string[];
    }>;
  };
}

// Vault detail from POST /v3/evk/vaults/batch (subset of fields we read)
export interface V3VaultDetail {
  chainId: number;
  address: string;
  vaultType: string;
  name: string;
  symbol: string;
  decimals: number;
  asset: EvkVaultAsset;
  totalAssets: string;
  totalShares?: string;
  totalBorrows: string;
  totalBorrowed?: string;
  totalCash?: string;
  totalSupplyUsd: number;
  totalBorrowsUsd: number;
  utilization: number;
  supplyApy: number; // percent, e.g. 1.45 = 1.45%
  borrowApy: number; // percent
  supplyCap?: string;
  borrowCap?: string;
  caps?: V3VaultCaps;
  fees?: V3VaultFees;
  hooks?: V3VaultHooks;
  liquidation?: V3VaultLiquidation;
  interestRateModel?: V3InterestRateModel;
  governor?: string;
  governorAdmin?: string;
  oracle?: V3OracleInfo;
  unitOfAccount?: EvkVaultAsset;
  timestamp?: string;
  collaterals?: V3Collateral[];
}

// Vault list item from GET /v3/evk/vaults?chainId= (flat snapshot, paged)
export interface V3VaultListItem {
  chainId: number;
  address: string;
  vaultType: string;
  name: string;
  symbol: string;
  decimals: number;
  asset: EvkVaultAsset;
  totalAssets: string;
  totalBorrows: string;
  totalSupplyUsd: number;
  totalBorrowsUsd: number;
  utilization: number;
  supplyApy: number;
  borrowApy: number;
}

// v3/earn/vaults/batch
export interface EulerEarnStrategy {
  address: string;
  vaultType: 'evk' | 'earn' | 'securitize' | 'unknown';
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  suppliedAssets: string;
  withdrawnAssets: string;
  allocatedAssets: string;
  allocatedAssetsUsd: number;
  availableAssets?: string;
  allocationCap?: {
    current: string;
    pending: string;
    pendingValidAt: string;
  };
  inSupplyQueue: boolean;
  inWithdrawQueue: boolean;
  supplyQueueIndex: number | null;
  withdrawQueueIndex: number | null;
  status: 'active' | 'inactive' | 'pending_removal';
  lastRebalancedAt?: string | null;
}

export interface EulerEarnGovernance {
  owner: string;
  creator: string;
  curator: string;
  guardian: string;
  feeReceiver: string;
  allocators: string[];
  timelock: number;
  pendingTimelock: number;
  pendingTimelockValidAt: string;
  pendingGuardian: string;
  pendingGuardianValidAt: string;
}

export interface EulerEarnManagement {
  owner: string;
  curator: string;
  guardian: string;
  feeRecipient: string;
  timelockSeconds: number;
  // 18-decimal fixed-point ratio, e.g. 1e17 = 10%.
  performanceFee: string;
}

export interface EulerEarnVault {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  asset: EvkVaultAsset;
  totalAssets: string;
  totalShares?: string;
  lostAssets?: string;
  exchangeRate?: string;
  totalSupplyUsd: number;
  availableAssets?: string;
  availableAssetsUsd?: number;
  supplyApy: number | null;
  apyCurrent: number | null;
  apy7d: number | null;
  apy30d: number | null;
  apy90d: number | null;
  utilization: number;
  strategyCount: number;
  strategies: EulerEarnStrategy[];
  governance?: EulerEarnGovernance;
  management?: EulerEarnManagement;
  snapshotTimestamp: string;
  createdAt: string;
}

export interface EulerEarnTotalsPoint {
  totalAssets: string;
  totalAssetsUsd: number | null;
  sharePrice: number | null;
  apy: number | null;
  timestamp: string;
}

export interface EulerEarnTotals {
  current: EulerEarnTotalsPoint;
  history: EulerEarnTotalsPoint[];
}

// v3/prices
export interface EulerPrice {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  priceUsd: number;
  source: string;
  confidence?: number;
  timestamp: string;
}

// v3/apys/intrinsic
export interface EulerIntrinsicApy {
  chainId: number;
  address: string;
  symbol?: string;
  apy: number; // percent
  provider: string;
  source: string;
  description?: string;
}

// v3/apys/rewards
export interface EulerRewardCampaign {
  id: string;
  provider: string;
  apr: number;
  status: string;
  rewardToken: { address: string; symbol: string; decimals: number };
}

export interface EulerVaultRewards {
  chainId: number;
  vault: string;
  campaigns: EulerRewardCampaign[];
  totalApr?: number;
}

// v3/accounts/{address}/portfolio — the connected account's holdings on one chain.
// Only the fields the Portfolio/Position pages read are typed; the payload carries more.

export interface EulerPortfolioTokenRef {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

// Vault reference embedded in every portfolio entry (EVault or EulerEarn).
export interface EulerPortfolioVaultRef {
  address: string;
  type: string; // 'EVault' | 'EulerEarn'
  asset: EulerPortfolioTokenRef;
  shares: EulerPortfolioTokenRef;
  supplyApy?: number;
  borrowApy?: number;
  supplyApy1h?: number;
  strategyCount?: number;
}

export interface EulerApyBreakdown {
  lending: number;
  borrowing: number;
  rewards: number;
  intrinsicApy: number;
  total: number;
}

// Entry in portfolio.savings / managedLending (Earn) / directLending (Lend).
export interface EulerDepositPosition {
  vault: EulerPortfolioVaultRef;
  subAccount: string;
  shares: string; // vault shares held (raw)
  assets: string; // underlying assets (raw, asset decimals)
  suppliedValueUsd: number;
  apy: number;
  apyBreakdown?: EulerApyBreakdown;
}

// Entry in portfolio.borrows — one open borrow position.
export interface EulerBorrowPosition {
  borrowVault: EulerPortfolioVaultRef;
  collateralVault: EulerPortfolioVaultRef;
  collateralVaults: string[];
  subAccount: string;
  healthFactor: string; // 1e18-fixed
  currentLTV: string; // 1e18-fixed
  userLTV: string; // 1e18-fixed
  borrowLTV: number; // decimal, e.g. 0.91
  liquidationLTV: number; // decimal, e.g. 0.93
  accountLiquidationLTV: number;
  borrowed: string; // raw units of the borrow asset
  supplied: string;
  liabilityValueUsd: number;
  totalCollateralValueUsd: number;
  borrowLiquidationPriceUsd: number;
  netApy: number;
  roe: number;
  multiplier: number;
  apyBreakdown: EulerApyBreakdown;
}

export interface EulerPortfolioTotals {
  suppliedValueUsd: number;
  borrowedValueUsd: number;
  netAssetValueUsd: number;
  netApy: number;
  roe: number;
  apyBreakdown: EulerApyBreakdown;
}

export interface EulerAccountPortfolio {
  chainId: number;
  owner: string;
  portfolio: {
    savings: EulerDepositPosition[]; // all deposits (Earn + Lend)
    managedLending: EulerDepositPosition[]; // Earn (EulerEarn) deposits
    directLending: EulerDepositPosition[]; // direct EVK Lend deposits
    borrows: EulerBorrowPosition[];
    totals: EulerPortfolioTotals;
  };
}
