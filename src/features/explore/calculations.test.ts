import { describe, expect, it } from 'vitest';

import {
  MATRIX_VIEW_IDS,
  buildCollateralMatrix,
  buildGraphDiagram,
  calculateApyMetrics,
  calculatePairMetrics,
  getArrow,
  getEnlargedDiagram,
  getGraphConnectedAddresses,
  getHeatmapValueRange,
  getLabelPosition,
  getMatrixHeatmapRange,
  getMaxMultiplier,
  getMaxRoe,
  getPairMetric,
  resolveDiscoverySelection
} from './calculations';
import {
  buildNormalizedMarket,
  getUnresolvedVaultAddresses,
  normalizeAddress,
  normalizeLtv,
  normalizeVault,
  type VaultLike
} from './model';

const makeVault = (
  address: string,
  symbol: string,
  {
    supplyApy = 0,
    borrowApy = 0,
    collaterals = []
  }: {
    supplyApy?: number;
    borrowApy?: number;
    collaterals?: NonNullable<VaultLike['collaterals']>;
  } = {}
): VaultLike => ({
  address,
  asset: { address: `${address}-asset`, symbol },
  supplyApy,
  borrowApy,
  utilization: 42,
  collaterals
});

const makeFixture = () => {
  const a = makeVault('0xA', 'USDC', {
    supplyApy: 2,
    borrowApy: 7,
    collaterals: [
      { collateral: '0xB', borrowLTV: '8000', liquidationLTV: '8500' },
      { collateral: '0xEXT', borrowLTV: '5000', liquidationLTV: '6000' },
      { collateral: '0xMissing', borrowLTV: '7000', liquidationLTV: '7500' },
      { collateral: '0xZero', borrowLTV: '0', liquidationLTV: '9000' }
    ]
  });
  const b = makeVault('0xB', 'USDC', {
    supplyApy: 5,
    borrowApy: 8,
    collaterals: [{ collateral: '0xA', borrowLTV: '6000', liquidationLTV: '7000' }]
  });
  const c = makeVault('0xC', 'WETH');
  const external = makeVault('0xEXT', 'USDT', { supplyApy: 4 });

  return buildNormalizedMarket([a, b, c], ['0xA', '0xb', '0xC'], [external]);
};

describe('normalization and market construction', () => {
  it('normalizes address identity, percentage APYs, and decimal LTVs', () => {
    const normalized = normalizeVault(
      makeVault(' 0xAbC ', 'USDC', {
        supplyApy: 4.25,
        borrowApy: 7.5,
        collaterals: [{ collateral: '0xDeF', borrowLTV: '8200', liquidationLTV: '8600' }]
      })
    );

    expect(normalizeAddress(' 0xAbC ')).toBe('0xabc');
    expect(normalizeLtv(0.82)).toBe(0.82);
    expect(normalizeLtv('8200')).toBe(0.82);
    expect(normalized).toMatchObject({
      address: '0xabc',
      supplyApy: 4.25,
      borrowApy: 7.5,
      collaterals: [{ address: '0xdef', borrowLtv: 0.82, liquidationLtv: 0.86 }]
    });
  });

  it('constructs members in product order and resolves explicit external collateral', () => {
    const market = makeFixture();

    expect(market.vaults.map((vault) => vault.address)).toEqual(['0xa', '0xb', '0xc']);
    expect(market.externalVaults.map((vault) => vault.address)).toEqual(['0xext']);
    expect(market.edges).toMatchObject([
      { from: '0xb', to: '0xa', borrowLtv: 0.8, liquidationLtv: 0.85 },
      { from: '0xext', to: '0xa', borrowLtv: 0.5, liquidationLtv: 0.6 },
      { from: '0xa', to: '0xb', borrowLtv: 0.6, liquidationLtv: 0.7 }
    ]);
  });

  it('omits zero-LTV and unresolved collateral edges', () => {
    const market = makeFixture();
    expect(market.edges.some((edge) => edge.from === '0xzero')).toBe(false);
    expect(market.edges.some((edge) => edge.from === '0xmissing')).toBe(false);
  });

  it('selects missing members and collateral references for the SDK fallback', () => {
    const source = makeVault('0xA', 'USDC', {
      collaterals: [
        { collateral: '0xExternal', borrowLTV: '8000', liquidationLTV: '8500' },
        { collateral: '0xResolved', borrowLTV: '7500', liquidationLTV: '8000' }
      ]
    });
    const resolved = makeVault('0xResolved', 'WETH');

    expect(getUnresolvedVaultAddresses([source, resolved], ['0xA', '0xMissing'])).toEqual(['0xexternal', '0xmissing']);
  });

  it('keeps a zero-borrow-LTV collateral visible while liquidation LTV ramps down', () => {
    const liability = makeVault('0xA', 'USDC', {
      collaterals: [
        {
          collateral: '0xB',
          borrowLTV: '0',
          liquidationLTV: '7000',
          currentLiquidationLTV: 0.8,
          initialLiquidationLTV: '9000',
          targetTimestamp: 2_000_000_000
        }
      ]
    });
    const collateral = makeVault('0xB', 'USDC');
    const market = buildNormalizedMarket([liability, collateral], ['0xA', '0xB']);
    const matrix = buildCollateralMatrix(market)!;
    const edge = matrix.cells.get('0xb')!.get('0xa')!.edge;

    expect(edge).toMatchObject({
      borrowLtv: 0,
      liquidationLtv: 0.8,
      targetLiquidationLtv: 0.7,
      isLiquidationLtvRamping: true
    });
    expect(matrix.pairCount).toBe(0);
    expect(getPairMetric(market, { edge }, 'lltv')).toEqual({ state: 'available', value: 80 });
  });
});

describe('deterministic graph calculations', () => {
  it('pins elliptical coordinates, mutual edges, and address-based asset identity', () => {
    const diagram = buildGraphDiagram(makeFixture());

    expect(diagram.nodes.map((node) => node.address)).toEqual(['0xa', '0xb', '0xext', '0xc']);
    expect(diagram.nodes.map(({ x, y }) => [x, y])).toEqual([
      [31.400000000000002, 12],
      [54.800000000000004, 30],
      [31.400000000000002, 48],
      [8, 30.000000000000004]
    ]);
    expect(diagram.edges.map((edge) => [edge.from.address, edge.to.address, edge.mutual])).toEqual([
      ['0xb', '0xa', true],
      ['0xext', '0xa', false]
    ]);
    expect(diagram.pairCount).toBe(3);
    expect(diagram.assetCount).toBe(3);
    expect(diagram.viewWidth).toBe(62.800000000000004);
  });

  it('keeps enlarged coordinates and connection lookup stable', () => {
    const diagram = buildGraphDiagram(makeFixture());
    const enlarged = getEnlargedDiagram(diagram);

    expect(enlarged).toMatchObject({
      viewWidth: 348.8,
      viewHeight: 272,
      centerX: 174.4,
      centerY: 136,
      nodeRadius: 15
    });
    expect(enlarged.nodes[0]).toMatchObject({ address: '0xa', x: 174.4, y: 48 });
    expect([...getGraphConnectedAddresses(diagram, '0xA')]).toEqual(['0xb', '0xext']);
  });

  it('pins arrow and outward label geometry, including degenerate positions', () => {
    expect(getArrow(0, 0, 10, 0, 2)).toEqual({
      lineX2: 2,
      lineY2: 0,
      triangle: '8,0 2,3 2,-3'
    });
    expect(getArrow(4, 4, 4, 4, 12)).toEqual({ lineX2: 4, lineY2: 4, triangle: '' });
    expect(getLabelPosition({ x: 10, y: 0 }, 0, 0)).toEqual({ x: 30, y: 4, anchor: 'start' });
    expect(getLabelPosition({ x: 0, y: 0 }, 0, 0)).toEqual({ x: 0, y: -22, anchor: 'middle' });
  });
});

describe('collateral matrix', () => {
  it('orders shared-axis vaults by combined LTV and appends escrow/external rows', () => {
    const matrix = buildCollateralMatrix(makeFixture());

    expect(matrix).not.toBeNull();
    expect(matrix!.columns.map((column) => [column.address, column.symbol])).toEqual([
      ['0xb', 'USDC'],
      ['0xa', 'USDC']
    ]);
    expect(matrix!.rows.map((row) => [row.address, row.symbol, row.category])).toEqual([
      ['0xb', 'USDC', 'borrowable'],
      ['0xa', 'USDC', 'borrowable'],
      ['0xc', 'WETH', 'escrow'],
      ['0xext', 'USDT', 'external']
    ]);
    expect(matrix!.pairCount).toBe(3);
  });
});

describe('matrix metrics', () => {
  it('exposes all eight matrix view identifiers in Euler Lite order', () => {
    expect(MATRIX_VIEW_IDS).toEqual(['stats', 'config', 'oracle', 'net-apy', 'roe', 'multiplier', 'bltv', 'lltv']);
  });

  it('calculates percentage APYs, max multiplier, and max ROE without rescaling', () => {
    expect(
      calculateApyMetrics({
        collateralSupplyApy: 5,
        liabilityBorrowApy: 7,
        supplyRewardsApy: 0.5,
        borrowRewardsApy: 1,
        loopingRewardsApy: 0.25
      })
    ).toEqual({ supplyApy: 5.5, borrowApy: 6, netApy: -0.25 });
    expect(getMaxMultiplier(0.8)).toBe(4.99);
    expect(getMaxMultiplier(0)).toBe(1);
    expect(getMaxRoe(4.99, 5.5, 6, 0.25)).toBeCloseTo(3.755);

    const market = makeFixture();
    const pair = calculatePairMetrics(market.vaultByAddress.get('0xb')!, market.vaultByAddress.get('0xa')!, 0.8, {
      supplyRewardsApy: 0.5,
      borrowRewardsApy: 1,
      loopingRewardsApy: 0.25
    });
    expect(pair).toEqual({
      supplyApy: 5.5,
      borrowApy: 6,
      netApy: -0.25,
      maxMultiplier: 4.99,
      maxRoe: 3.755
    });
  });

  it('returns explicit unavailable states for non-numeric and uncorrelated metrics', () => {
    const market = makeFixture();
    const matrix = buildCollateralMatrix(market)!;
    const cell = matrix.cells.get('0xb')!.get('0xa')!;

    expect(getPairMetric(market, cell, 'roe', false)).toEqual({
      state: 'unavailable',
      reason: 'uncorrelated-pair'
    });
    expect(getPairMetric(market, cell, 'multiplier', false)).toEqual({
      state: 'unavailable',
      reason: 'uncorrelated-pair'
    });
    expect(getPairMetric(market, cell, 'oracle')).toEqual({
      state: 'unavailable',
      reason: 'non-numeric-view'
    });
    expect(getPairMetric(market, cell, 'net-apy', false)).toEqual({ state: 'available', value: -2 });
  });

  it('derives finite heatmap ranges and falls back to zero for unavailable data', () => {
    const market = makeFixture();
    const matrix = buildCollateralMatrix(market)!;

    expect(getMatrixHeatmapRange(market, matrix, 'net-apy')).toEqual({ min: -6, max: -2 });
    expect(getMatrixHeatmapRange(market, matrix, 'roe', () => false)).toEqual({ min: 0, max: 0 });
    expect(
      getHeatmapValueRange([{ state: 'unavailable', reason: 'uncorrelated-pair' }, Number.NaN, -3, { state: 'available', value: 8 }])
    ).toEqual({ min: -3, max: 8 });
  });
});

describe('selection result resolution', () => {
  it('maps graph, cell, row, and column selections to lend and borrow destinations', () => {
    const market = makeFixture();
    const matrix = buildCollateralMatrix(market)!;

    expect(resolveDiscoverySelection(market, matrix, { kind: 'graph', address: '0xa' })).toEqual({
      lendAddress: '0xa',
      borrowPairs: [
        { collateralAddress: '0xb', liabilityAddress: '0xa' },
        { collateralAddress: '0xext', liabilityAddress: '0xa' }
      ]
    });
    expect(
      resolveDiscoverySelection(market, matrix, {
        kind: 'cell',
        collateralAddress: '0xext',
        liabilityAddress: '0xa'
      })
    ).toEqual({
      lendAddress: '0xa',
      borrowPairs: [{ collateralAddress: '0xext', liabilityAddress: '0xa' }]
    });
    expect(resolveDiscoverySelection(market, matrix, { kind: 'header', address: '0xb', axis: 'row' })).toEqual({
      lendAddress: '0xb',
      borrowPairs: [{ collateralAddress: '0xb', liabilityAddress: '0xa' }]
    });
    expect(resolveDiscoverySelection(market, matrix, { kind: 'header', address: '0xb', axis: 'column' })).toEqual({
      lendAddress: '0xb',
      borrowPairs: [{ collateralAddress: '0xa', liabilityAddress: '0xb' }]
    });
  });
});
