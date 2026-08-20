/**
 * Pure discovery calculations ported from Euler Lite commit
 * 369b121ce13af93a23a85f11d42112c34b48998b:
 * https://github.com/euler-xyz/euler-lite/blob/369b121ce13af93a23a85f11d42112c34b48998b/utils/discoveryCalculations.ts
 */

import { normalizeAddress, type NormalizedAddress, type NormalizedEdge, type NormalizedMarket, type NormalizedVault } from './model';

export const MATRIX_VIEW_IDS = ['stats', 'config', 'oracle', 'net-apy', 'roe', 'multiplier', 'bltv', 'lltv'] as const;

export type MatrixViewId = (typeof MATRIX_VIEW_IDS)[number];
export type PairMetricViewId = Exclude<MatrixViewId, 'stats' | 'config'>;

export interface MatrixViewOption {
  id: MatrixViewId;
  label: string;
}

export const MATRIX_VIEW_OPTIONS: readonly MatrixViewOption[] = [
  { id: 'stats', label: 'Stats' },
  { id: 'config', label: 'Configuration' },
  { id: 'oracle', label: 'Oracles' },
  { id: 'net-apy', label: 'Net APY' },
  { id: 'roe', label: 'Max ROE' },
  { id: 'multiplier', label: 'Multiplier' },
  { id: 'bltv', label: 'Borrow LTV' },
  { id: 'lltv', label: 'Liquidation LTV' }
];

export const isAttributeMatrixView = (id: MatrixViewId): id is 'stats' | 'config' => id === 'stats' || id === 'config';

export interface GraphNode {
  address: NormalizedAddress;
  assetAddress: NormalizedAddress;
  assetSymbol: string;
  x: number;
  y: number;
  external: boolean;
}

export interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  mutual: boolean;
}

export interface GraphDiagram {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pairCount: number;
  assetCount: number;
  viewWidth: number;
}

export const buildGraphDiagram = (market: NormalizedMarket): GraphDiagram => {
  const connected = new Set<NormalizedAddress>();
  for (const edge of market.edges) {
    // Euler Lite inserts the liability before the collateral. Preserving that
    // insertion order makes radial coordinates stable for the same payload.
    connected.add(edge.to);
    connected.add(edge.from);
  }

  const memberAddresses = new Set(market.vaults.map((vault) => vault.address));
  const nodeAddresses = [...connected];
  for (const vault of market.vaults) {
    if (!connected.has(vault.address)) nodeAddresses.push(vault.address);
  }

  if (nodeAddresses.length === 0) {
    return { nodes: [], edges: [], pairCount: 0, assetCount: 0, viewWidth: 0 };
  }

  const count = nodeAddresses.length;
  const baseRadius = Math.min(24, 10 + count * 2);
  const stretch = count > 6 ? 1.6 : count > 3 ? 1.3 : 1;
  const radiusX = baseRadius * stretch;
  const radiusY = baseRadius;
  const centerX = radiusX + 8;
  const centerY = 30;
  const assetSymbols = new Set<string>();

  const nodes = nodeAddresses.flatMap((address, index): GraphNode[] => {
    const vault = market.vaultByAddress.get(address);
    if (!vault) return [];
    const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
    assetSymbols.add(vault.asset.symbol);
    return [
      {
        address,
        assetAddress: vault.asset.address,
        assetSymbol: vault.asset.symbol,
        x: centerX + radiusX * Math.cos(angle),
        y: centerY + radiusY * Math.sin(angle),
        external: !memberAddresses.has(address)
      }
    ];
  });

  const nodeByAddress = new Map(nodes.map((node) => [node.address, node]));
  const directedEdges = new Set(market.edges.map((edge) => `${edge.from}:${edge.to}`));
  const seenPairs = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const edge of market.edges) {
    const pairKey = [edge.from, edge.to].sort().join(':');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const from = nodeByAddress.get(edge.from);
    const to = nodeByAddress.get(edge.to);
    if (!from || !to) continue;
    edges.push({
      from,
      to,
      mutual: directedEdges.has(`${edge.to}:${edge.from}`)
    });
  }

  return {
    nodes,
    edges,
    pairCount: market.edges.filter((edge) => edge.borrowLtv > 0).length,
    assetCount: assetSymbols.size,
    viewWidth: centerX + radiusX + 8
  };
};

export const estimateLabelWidth = (symbol: string): number => symbol.length * 7;

export const getEnlargedDiagram = (diagram: GraphDiagram) => {
  const count = diagram.nodes.length;
  const baseRadius = Math.min(120, 40 + count * 12);
  const stretch = count > 6 ? 1.6 : count > 3 ? 1.3 : 1;
  const radiusX = baseRadius * stretch;
  const radiusY = baseRadius;
  const labelOffset = 20;
  const maxLabelWidth = Math.max(...diagram.nodes.map((node) => estimateLabelWidth(node.assetSymbol)), 0);
  const centerX = radiusX + labelOffset + maxLabelWidth + 12;
  const centerY = radiusY + labelOffset + 16 + 12;
  const nodeRadius = 15;

  const nodes = diagram.nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
    return {
      ...node,
      x: centerX + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle)
    };
  });
  const nodeByAddress = new Map(nodes.map((node) => [node.address, node]));
  const edges = diagram.edges.map((edge) => ({
    ...edge,
    from: nodeByAddress.get(edge.from.address)!,
    to: nodeByAddress.get(edge.to.address)!
  }));

  return {
    nodes,
    edges,
    viewWidth: centerX * 2,
    viewHeight: centerY * 2,
    centerX,
    centerY,
    nodeRadius
  };
};

export const ARROW_SIZE = 6;

export const getArrow = (fromX: number, fromY: number, toX: number, toY: number, nodeRadius: number) => {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return { lineX2: toX, lineY2: toY, triangle: '' };

  const unitX = dx / distance;
  const unitY = dy / distance;
  const tipX = toX - unitX * nodeRadius;
  const tipY = toY - unitY * nodeRadius;
  const baseX = tipX - unitX * ARROW_SIZE;
  const baseY = tipY - unitY * ARROW_SIZE;
  const perpendicularX = -unitY * (ARROW_SIZE * 0.5);
  const perpendicularY = unitX * (ARROW_SIZE * 0.5);

  return {
    lineX2: baseX,
    lineY2: baseY,
    triangle: `${tipX},${tipY} ${baseX + perpendicularX},${baseY + perpendicularY} ${baseX - perpendicularX},${baseY - perpendicularY}`
  };
};

export const getLabelPosition = (node: { x: number; y: number }, centerX: number, centerY: number) => {
  const dx = node.x - centerX;
  const dy = node.y - centerY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return { x: node.x, y: node.y - 22, anchor: 'middle' as const };

  const normalX = dx / distance;
  const normalY = dy / distance;
  const anchor = normalX < -0.3 ? ('end' as const) : normalX > 0.3 ? ('start' as const) : ('middle' as const);
  return {
    x: node.x + normalX * 20,
    y: node.y + normalY * 20 + 4,
    anchor
  };
};

export const getGraphConnectedAddresses = (diagram: GraphDiagram, address: string): Set<NormalizedAddress> => {
  const normalized = normalizeAddress(address);
  const connected = new Set<NormalizedAddress>();
  for (const edge of diagram.edges) {
    if (edge.from.address === normalized) connected.add(edge.to.address);
    if (edge.to.address === normalized) connected.add(edge.from.address);
  }
  return connected;
};

export interface MatrixAxisItem {
  address: NormalizedAddress;
  symbol: string;
  assetAddress: NormalizedAddress;
}

export interface MatrixRow extends MatrixAxisItem {
  category: 'borrowable' | 'escrow' | 'external';
}

export interface MatrixCell {
  edge: NormalizedEdge;
}

export interface CollateralMatrix {
  rows: MatrixRow[];
  columns: MatrixAxisItem[];
  cells: Map<NormalizedAddress, Map<NormalizedAddress, MatrixCell>>;
  pairCount: number;
}

const axisItem = (vault: NormalizedVault): MatrixAxisItem => ({
  address: vault.address,
  symbol: vault.asset.symbol,
  assetAddress: vault.asset.address
});

export const buildCollateralMatrix = (market: NormalizedMarket): CollateralMatrix | null => {
  const hasActiveCollateral = (vault: NormalizedVault) =>
    vault.collaterals.some((collateral) => collateral.borrowLtv > 0 || collateral.liquidationLtv > 0);
  const borrowable = market.vaults.filter(hasActiveCollateral);
  const nonBorrowable = market.vaults.filter((vault) => !hasActiveCollateral(vault));

  const cells = new Map<NormalizedAddress, Map<NormalizedAddress, MatrixCell>>();
  const referencedCollateral = new Set<NormalizedAddress>();
  const connectedBorrowable = new Set<NormalizedAddress>();

  for (const edge of market.edges) {
    referencedCollateral.add(edge.from);
    connectedBorrowable.add(edge.to);
    const row = cells.get(edge.from) ?? new Map<NormalizedAddress, MatrixCell>();
    row.set(edge.to, { edge });
    cells.set(edge.from, row);
  }

  if (cells.size === 0) return null;

  const rowAverageLtv = (address: NormalizedAddress): number => {
    const row = cells.get(address);
    if (!row?.size) return 0;
    let sum = 0;
    for (const cell of row.values()) sum += cell.edge.borrowLtv;
    return sum / row.size;
  };

  const columnAverageLtv = (address: NormalizedAddress): number => {
    let sum = 0;
    let count = 0;
    for (const row of cells.values()) {
      const cell = row.get(address);
      if (!cell) continue;
      sum += cell.edge.borrowLtv;
      count += 1;
    }
    return count ? sum / count : 0;
  };

  const both: NormalizedVault[] = [];
  const rowsOnly: NormalizedVault[] = [];
  const columnsOnly: NormalizedVault[] = [];
  for (const vault of borrowable) {
    const inRows = referencedCollateral.has(vault.address);
    const inColumns = connectedBorrowable.has(vault.address);
    if (inRows && inColumns) both.push(vault);
    else if (inRows) rowsOnly.push(vault);
    else if (inColumns) columnsOnly.push(vault);
  }

  const byDescending = (value: (address: NormalizedAddress) => number) => (a: NormalizedVault, b: NormalizedVault) =>
    value(b.address) - value(a.address);
  const combinedAverageLtv = (address: NormalizedAddress) => (rowAverageLtv(address) + columnAverageLtv(address)) / 2;

  const diagonal = [...both].sort(byDescending(combinedAverageLtv));
  const rowOnly = [...rowsOnly].sort(byDescending(rowAverageLtv));
  const columnOnly = [...columnsOnly].sort(byDescending(columnAverageLtv));
  const escrowRows = [...nonBorrowable].sort(byDescending(rowAverageLtv));
  const externalRows = [...market.externalVaults].sort(byDescending(rowAverageLtv));

  const rows: MatrixRow[] = [];
  const seenRows = new Set<NormalizedAddress>();
  const addRow = (vault: NormalizedVault, category: MatrixRow['category']) => {
    if (seenRows.has(vault.address)) return;
    seenRows.add(vault.address);
    rows.push({ ...axisItem(vault), category });
  };

  for (const vault of diagonal) addRow(vault, 'borrowable');
  for (const vault of rowOnly) addRow(vault, 'borrowable');
  for (const vault of escrowRows) addRow(vault, 'escrow');
  for (const vault of externalRows) addRow(vault, 'external');

  return {
    rows,
    columns: [...diagonal, ...columnOnly].map(axisItem),
    cells,
    pairCount: market.edges.filter((edge) => edge.borrowLtv > 0).length
  };
};

export interface ApyInputs {
  collateralSupplyApy: number;
  liabilityBorrowApy: number;
  supplyRewardsApy?: number;
  borrowRewardsApy?: number;
  loopingRewardsApy?: number;
}

export interface ApyMetrics {
  supplyApy: number;
  borrowApy: number;
  netApy: number;
}

const finiteOrZero = (value: number | undefined): number => (Number.isFinite(value) ? (value as number) : 0);

export const calculateApyMetrics = ({
  collateralSupplyApy,
  liabilityBorrowApy,
  supplyRewardsApy = 0,
  borrowRewardsApy = 0,
  loopingRewardsApy = 0
}: ApyInputs): ApyMetrics => {
  const supplyApy = finiteOrZero(collateralSupplyApy) + finiteOrZero(supplyRewardsApy);
  const borrowApy = finiteOrZero(liabilityBorrowApy) - finiteOrZero(borrowRewardsApy);
  return {
    supplyApy,
    borrowApy,
    netApy: supplyApy - borrowApy + finiteOrZero(loopingRewardsApy)
  };
};

/**
 * `1 / (1 - LTV) - 0.005`, floored to two decimals, minimum one.
 */
export const getMaxMultiplier = (borrowLtv: number, safetyMargin = 0.005): number => {
  if (!Number.isFinite(borrowLtv) || borrowLtv <= 0 || borrowLtv >= 1) return 1;
  const raw = 1 / (1 - borrowLtv) - safetyMargin;
  return Math.max(1, Math.floor(raw * 100) / 100);
};

export const getMaxRoe = (maxMultiplier: number, supplyApy: number, borrowApy: number, loopingRewardsApy = 0): number => {
  if (![maxMultiplier, supplyApy, borrowApy, loopingRewardsApy].every(Number.isFinite)) return 0;
  return supplyApy + (maxMultiplier - 1) * (supplyApy - borrowApy) + loopingRewardsApy;
};

export interface PairMetrics extends ApyMetrics {
  maxMultiplier: number;
  maxRoe: number;
}

export const calculatePairMetrics = (
  collateral: NormalizedVault,
  liability: NormalizedVault,
  borrowLtv: number,
  adjustments: Omit<ApyInputs, 'collateralSupplyApy' | 'liabilityBorrowApy'> = {}
): PairMetrics => {
  const apys = calculateApyMetrics({
    collateralSupplyApy: collateral.supplyApy,
    liabilityBorrowApy: liability.borrowApy,
    ...adjustments
  });
  const maxMultiplier = getMaxMultiplier(borrowLtv);
  return {
    ...apys,
    maxMultiplier,
    maxRoe: getMaxRoe(maxMultiplier, apys.supplyApy, apys.borrowApy, adjustments.loopingRewardsApy)
  };
};

export type MetricUnavailableReason = 'missing-vault' | 'uncorrelated-pair' | 'non-numeric-view';

export type MetricResult = { state: 'available'; value: number } | { state: 'unavailable'; reason: MetricUnavailableReason };

export const getPairMetric = (
  market: NormalizedMarket,
  cell: MatrixCell,
  view: MatrixViewId,
  correlated = true,
  adjustments: Omit<ApyInputs, 'collateralSupplyApy' | 'liabilityBorrowApy'> = {}
): MetricResult => {
  if (isAttributeMatrixView(view) || view === 'oracle') {
    return { state: 'unavailable', reason: 'non-numeric-view' };
  }

  const collateral = market.vaultByAddress.get(cell.edge.from);
  const liability = market.vaultByAddress.get(cell.edge.to);
  if (!collateral || !liability) return { state: 'unavailable', reason: 'missing-vault' };
  if (!correlated && (view === 'roe' || view === 'multiplier')) {
    return { state: 'unavailable', reason: 'uncorrelated-pair' };
  }

  const metrics = calculatePairMetrics(collateral, liability, cell.edge.borrowLtv, adjustments);
  switch (view) {
    case 'bltv':
      return { state: 'available', value: cell.edge.borrowLtv * 100 };
    case 'lltv':
      return { state: 'available', value: cell.edge.liquidationLtv * 100 };
    case 'net-apy':
      return { state: 'available', value: metrics.netApy };
    case 'roe':
      return { state: 'available', value: metrics.maxRoe };
    case 'multiplier':
      return { state: 'available', value: metrics.maxMultiplier };
  }
};

export interface HeatmapValueRange {
  min: number;
  max: number;
}

export const getHeatmapValueRange = (values: Iterable<number | MetricResult>): HeatmapValueRange => {
  let min = Infinity;
  let max = -Infinity;

  for (const item of values) {
    const value = typeof item === 'number' ? item : item.state === 'available' ? item.value : Number.NaN;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
};

export const getMatrixHeatmapRange = (
  market: NormalizedMarket,
  matrix: CollateralMatrix,
  view: MatrixViewId,
  isCorrelated: (collateralAddress: NormalizedAddress, liabilityAddress: NormalizedAddress) => boolean = () => true
): HeatmapValueRange => {
  const values: MetricResult[] = [];
  for (const [collateralAddress, row] of matrix.cells) {
    for (const [liabilityAddress, cell] of row) {
      values.push(getPairMetric(market, cell, view, isCorrelated(collateralAddress, liabilityAddress)));
    }
  }
  return getHeatmapValueRange(values);
};

export type DiscoverySelection =
  | { kind: 'graph'; address: NormalizedAddress }
  | { kind: 'cell'; collateralAddress: NormalizedAddress; liabilityAddress: NormalizedAddress }
  | { kind: 'header'; address: NormalizedAddress; axis: 'row' | 'column' };

export interface ResolvedSelection {
  lendAddress: NormalizedAddress | null;
  borrowPairs: Array<{
    collateralAddress: NormalizedAddress;
    liabilityAddress: NormalizedAddress;
  }>;
}

export const resolveDiscoverySelection = (
  market: NormalizedMarket,
  matrix: CollateralMatrix,
  selection: DiscoverySelection
): ResolvedSelection => {
  const lendAddress =
    selection.kind === 'cell'
      ? selection.liabilityAddress
      : selection.kind === 'header' || selection.kind === 'graph'
        ? selection.address
        : null;
  const borrowPairs: ResolvedSelection['borrowPairs'] = [];

  if (selection.kind === 'cell') {
    const cell = matrix.cells.get(selection.collateralAddress)?.get(selection.liabilityAddress);
    if (cell && cell.edge.borrowLtv > 0) {
      borrowPairs.push({
        collateralAddress: selection.collateralAddress,
        liabilityAddress: selection.liabilityAddress
      });
    }
  } else if (selection.kind === 'header' && selection.axis === 'row') {
    for (const [liabilityAddress, cell] of matrix.cells.get(selection.address) ?? []) {
      if (cell.edge.borrowLtv > 0) borrowPairs.push({ collateralAddress: selection.address, liabilityAddress });
    }
  } else {
    const liabilityAddress = selection.address;
    for (const [collateralAddress, row] of matrix.cells) {
      const cell = row.get(liabilityAddress);
      if (cell && cell.edge.borrowLtv > 0) borrowPairs.push({ collateralAddress, liabilityAddress });
    }
  }

  return {
    lendAddress: lendAddress && market.vaultByAddress.has(lendAddress) ? lendAddress : null,
    borrowPairs
  };
};
