/**
 * Normalized discovery contracts adapted from Euler Lite:
 * https://github.com/euler-xyz/euler-lite/tree/369b121ce13af93a23a85f11d42112c34b48998b
 *
 * APYs are percentage numbers (5.2 means 5.2%). LTVs are decimal ratios
 * (0.85 means 85%). Addresses are lowercase identity keys.
 */

export type NormalizedAddress = string;

export interface NormalizedAsset {
  address: NormalizedAddress;
  symbol: string;
}

export interface NormalizedCollateral {
  address: NormalizedAddress;
  borrowLtv: number;
  liquidationLtv: number;
  targetLiquidationLtv: number;
  isLiquidationLtvRamping: boolean;
}

export interface NormalizedVault {
  address: NormalizedAddress;
  asset: NormalizedAsset;
  supplyApy: number;
  borrowApy: number;
  utilization: number;
  collaterals: NormalizedCollateral[];
}

export interface NormalizedEdge {
  /** Collateral vault. */
  from: NormalizedAddress;
  /** Liability vault. */
  to: NormalizedAddress;
  borrowLtv: number;
  liquidationLtv: number;
  targetLiquidationLtv: number;
  isLiquidationLtvRamping: boolean;
}

export interface NormalizedMarket {
  vaults: NormalizedVault[];
  externalVaults: NormalizedVault[];
  edges: NormalizedEdge[];
  vaultByAddress: ReadonlyMap<NormalizedAddress, NormalizedVault>;
}

/**
 * Structural input accepted by the adapter. It intentionally does not import
 * API types, so V3VaultDetail/V3Collateral and equivalent SDK-shaped objects
 * can both be consumed without coupling this feature to either representation.
 */
export interface VaultLike {
  address?: unknown;
  asset?: {
    address?: unknown;
    symbol?: unknown;
  } | null;
  supplyApy?: unknown;
  borrowApy?: unknown;
  utilization?: unknown;
  interestRates?: {
    supplyAPY?: unknown;
    borrowAPY?: unknown;
  } | null;
  collaterals?: readonly CollateralLike[] | null;
}

export interface CollateralLike {
  collateral?: unknown;
  address?: unknown;
  borrowLTV?: unknown;
  liquidationLTV?: unknown;
  currentLiquidationLTV?: unknown;
  initialLiquidationLTV?: unknown;
  targetTimestamp?: unknown;
  ramping?: {
    initialLiquidationLTV?: unknown;
    targetTimestamp?: unknown;
  } | null;
}

export const normalizeAddress = (address: unknown): NormalizedAddress => (typeof address === 'string' ? address.trim().toLowerCase() : '');

const finiteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * V3 serializes LTVs as basis-point strings, while SDK-compatible inputs use
 * decimal numbers. Bigints and numeric values above one are also interpreted
 * as basis points. The normalized result is always clamped to [0, 1].
 */
export const normalizeLtv = (value: unknown): number => {
  let parsed = finiteNumber(value);
  if (typeof value === 'bigint' || typeof value === 'string' || parsed > 1) {
    parsed /= 10_000;
  }
  return Math.min(1, Math.max(0, parsed));
};

export const normalizeVault = (input: VaultLike): NormalizedVault | null => {
  const address = normalizeAddress(input.address);
  const assetAddress = normalizeAddress(input.asset?.address);
  if (!address || !assetAddress) return null;

  const collaterals: NormalizedCollateral[] = [];
  const seen = new Set<NormalizedAddress>();

  for (const collateral of input.collaterals ?? []) {
    const collateralAddress = normalizeAddress(collateral.collateral ?? collateral.address);
    if (!collateralAddress || seen.has(collateralAddress)) continue;
    seen.add(collateralAddress);

    const targetLiquidationLtv = normalizeLtv(collateral.liquidationLTV);
    const liquidationLtv = normalizeLtv(collateral.currentLiquidationLTV ?? collateral.liquidationLTV);
    const initialLiquidationLtv = normalizeLtv(
      collateral.initialLiquidationLTV ?? collateral.ramping?.initialLiquidationLTV ?? liquidationLtv
    );
    const targetTimestamp = finiteNumber(collateral.targetTimestamp ?? collateral.ramping?.targetTimestamp);

    collaterals.push({
      address: collateralAddress,
      borrowLtv: normalizeLtv(collateral.borrowLTV),
      liquidationLtv,
      targetLiquidationLtv,
      isLiquidationLtvRamping:
        targetTimestamp > 0 &&
        (Math.abs(liquidationLtv - targetLiquidationLtv) > Number.EPSILON ||
          Math.abs(initialLiquidationLtv - targetLiquidationLtv) > Number.EPSILON)
    });
  }

  return {
    address,
    asset: {
      address: assetAddress,
      symbol: typeof input.asset?.symbol === 'string' && input.asset.symbol ? input.asset.symbol : '?'
    },
    supplyApy: finiteNumber(input.supplyApy ?? input.interestRates?.supplyAPY),
    borrowApy: finiteNumber(input.borrowApy ?? input.interestRates?.borrowAPY),
    utilization: finiteNumber(input.utilization),
    collaterals
  };
};

export const normalizeVaults = (inputs: readonly VaultLike[]): NormalizedVault[] => {
  const result: NormalizedVault[] = [];
  const seen = new Set<NormalizedAddress>();

  for (const input of inputs) {
    const vault = normalizeVault(input);
    if (!vault || seen.has(vault.address)) continue;
    seen.add(vault.address);
    result.push(vault);
  }

  return result;
};

/**
 * Addresses that the lazy SDK fallback must resolve: missing product members
 * plus collateral references absent from the V3 batch response.
 */
export const getUnresolvedVaultAddresses = (
  resolvedVaults: readonly VaultLike[],
  productMemberAddresses: readonly string[]
): NormalizedAddress[] => {
  const normalizedVaults = normalizeVaults(resolvedVaults);
  const resolved = new Set(normalizedVaults.map((vault) => vault.address));
  const unresolved = new Set<NormalizedAddress>();

  for (const rawAddress of productMemberAddresses) {
    const address = normalizeAddress(rawAddress);
    if (address && !resolved.has(address)) unresolved.add(address);
  }
  for (const vault of normalizedVaults) {
    for (const collateral of vault.collaterals) {
      if (!resolved.has(collateral.address)) unresolved.add(collateral.address);
    }
  }

  return [...unresolved].sort();
};

const isActiveCollateral = (collateral: NormalizedCollateral): boolean => collateral.borrowLtv > 0 || collateral.liquidationLtv > 0;

/**
 * Resolves product members in product-address order, then attaches explicitly
 * supplied external vaults. Only relationships to resolved members/externals
 * are emitted; zero-borrow-LTV and unresolved relationships are omitted.
 */
export const buildNormalizedMarket = (
  resolvedVaults: readonly VaultLike[],
  productMemberAddresses: readonly string[],
  externalVaults: readonly VaultLike[] = []
): NormalizedMarket => {
  const resolved = normalizeVaults(resolvedVaults);
  const normalizedExternal = normalizeVaults(externalVaults);
  const resolvedByAddress = new Map(resolved.map((vault) => [vault.address, vault]));

  const vaults: NormalizedVault[] = [];
  const memberAddresses = new Set<NormalizedAddress>();
  for (const rawAddress of productMemberAddresses) {
    const address = normalizeAddress(rawAddress);
    const vault = resolvedByAddress.get(address);
    if (!vault || memberAddresses.has(address)) continue;
    memberAddresses.add(address);
    vaults.push(vault);
  }

  const external: NormalizedVault[] = [];
  const externalAddresses = new Set<NormalizedAddress>();
  for (const vault of normalizedExternal) {
    if (memberAddresses.has(vault.address) || externalAddresses.has(vault.address)) continue;
    externalAddresses.add(vault.address);
    external.push(vault);
  }

  const vaultByAddress = new Map<NormalizedAddress, NormalizedVault>();
  for (const vault of [...vaults, ...external]) vaultByAddress.set(vault.address, vault);

  const edges: NormalizedEdge[] = [];
  const seenEdges = new Set<string>();
  for (const liabilityVault of vaults) {
    for (const collateral of liabilityVault.collaterals) {
      if (!isActiveCollateral(collateral) || !vaultByAddress.has(collateral.address)) continue;
      const key = `${collateral.address}:${liabilityVault.address}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({
        from: collateral.address,
        to: liabilityVault.address,
        borrowLtv: collateral.borrowLtv,
        liquidationLtv: collateral.liquidationLtv,
        targetLiquidationLtv: collateral.targetLiquidationLtv,
        isLiquidationLtvRamping: collateral.isLiquidationLtvRamping
      });
    }
  }

  return { vaults, externalVaults: external, edges, vaultByAddress };
};
