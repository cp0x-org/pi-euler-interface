import { useState } from 'react';
import { Box, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';

import { tokenImageUrl } from '@/api/euler';
import { TokenIcon } from 'components/TokenIcon';
import { formatShortUSDS, shortenAddress } from 'utils/formatters';

import { getMatrixHeatmapRange, getPairMetric, type CollateralMatrix, type MatrixViewId } from './calculations';
import type { NormalizedMarket, NormalizedVault } from './model';

export interface MatrixSelection {
  collateralAddress: string;
  liabilityAddress: string;
}

export interface HeaderSelection {
  address: string;
  axis: 'row' | 'column';
}

interface DiscoveryMatrixProps {
  chainId: number;
  market: NormalizedMarket;
  matrix: CollateralMatrix;
  view: MatrixViewId;
  rawVaultByAddress: ReadonlyMap<string, unknown>;
  oracleMetadata?: Readonly<Record<string, unknown>>;
  selectedCell: MatrixSelection | null;
  selectedHeader: HeaderSelection | null;
  onSelectCell: (selection: MatrixSelection) => void;
  onSelectHeader: (selection: HeaderSelection) => void;
}

type RawRecord = Record<string, unknown>;

const record = (value: unknown): RawRecord => (value != null && typeof value === 'object' ? (value as RawRecord) : {});

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bigintValue = (value: unknown) => {
  try {
    return typeof value === 'bigint' ? value : BigInt(String(value ?? 0));
  } catch {
    return 0n;
  }
};

const displayPercent = (value: number, digits = 2) => (Number.isFinite(value) ? `${value.toFixed(digits)}%` : '—');

const displayCap = (raw: unknown, vault: NormalizedVault, rawVault: unknown) => {
  const cap = bigintValue(raw);
  if (cap === 0n) return '$0';
  if (cap >= 1n << 250n) return '∞';
  const source = record(rawVault);
  const totalAssets = bigintValue(source.totalAssets);
  const totalSupplyUsd = numberValue(source.totalSupplyUsd);
  if (totalAssets > 0n && totalSupplyUsd > 0) {
    return `$${formatShortUSDS((Number(cap) / Number(totalAssets)) * totalSupplyUsd)}`;
  }
  const decimals = numberValue(record(source.asset).decimals, 18);
  const amount = Number(cap) / 10 ** decimals;
  return `${formatShortUSDS(amount)} ${vault.asset.symbol}`;
};

const capUsage = (current: unknown, cap: unknown) => {
  const currentValue = bigintValue(current);
  const capValue = bigintValue(cap);
  if (capValue >= 1n << 250n) return null;
  if (capValue === 0n) return currentValue > 0n ? 101 : 0;
  return (Number(currentValue) / Number(capValue)) * 100;
};

const hookedOperations = (rawVault: unknown) => {
  const operations = record(record(rawVault).hooks).hookedOperations;
  const active = Object.entries(record(operations))
    .filter(([, enabled]) => enabled)
    .map(([operation]) => operation);
  if (!active.length) return 'None';
  if (active.length > 7) return 'All';
  return active.map((operation) => operation.replace(/([A-Z])/g, ' $1').trim()).join(', ');
};

const interestRateModel = (rawVault: unknown) => {
  const model = record(rawVault).interestRateModel;
  const rawType = record(model).type;
  if (rawType == null) return '—';
  const label = String(rawType).replaceAll('_', ' ').toLowerCase();
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const oracleAddress = (rawVault: unknown) => {
  const oracle = record(rawVault).oracle;
  if (typeof oracle === 'string') return oracle;
  const address = record(oracle).oracle ?? record(oracle).address;
  return typeof address === 'string' ? address.toLowerCase() : '';
};

const sameRiskCategory = (collateral: NormalizedVault, liability: NormalizedVault) => {
  if (collateral.asset.address === liability.asset.address) return true;
  const left = collateral.asset.symbol.toUpperCase();
  const right = liability.asset.symbol.toUpperCase();
  const groups = [
    ['USD', 'USDC', 'USDT', 'DAI', 'PYUSD', 'RLUSD', 'USDE', 'USD0', 'USDS'],
    ['ETH', 'WETH', 'STETH', 'WSTETH', 'RETH', 'WEETH', 'EZETH'],
    ['BTC', 'WBTC', 'TBTC', 'CBBTC']
  ];
  return groups.some((group) => group.some((token) => left.includes(token)) && group.some((token) => right.includes(token)));
};

const cellColor = (value: number, view: MatrixViewId, min: number, max: number) => {
  if (view === 'bltv' || view === 'lltv' || view === 'multiplier') {
    const percent = view === 'multiplier' ? (value > 1 ? (1 - 1 / value) * 100 : 0) : value;
    const position = Math.max(0, Math.min(100, percent)) / 100;
    const alphaValue = 0.1 + position * 0.2;
    const hue = position < 0.75 ? 145 - (position / 0.75) * 100 : 45 - ((position - 0.75) / 0.25) * 45;
    return `hsla(${hue}, 72%, 45%, ${alphaValue})`;
  }
  if (view === 'net-apy' || view === 'roe') {
    if (min >= max || Math.abs(value) < 0.01) return 'transparent';
    const positive = value > 0;
    const scale = positive ? Math.min(value / (max || 1), 1) : Math.min(Math.abs(value) / (Math.abs(min) || 1), 1);
    return positive ? `hsla(145, 70%, 45%, ${0.08 + scale * 0.22})` : `hsla(0, 75%, 48%, ${0.08 + scale * 0.22})`;
  }
  return 'transparent';
};

const formatMetric = (value: number, view: MatrixViewId) => (view === 'multiplier' ? `${value.toFixed(1)}x` : `${value.toFixed(1)}%`);

const attributeIds = {
  stats: [
    'totalSupply',
    'totalBorrow',
    'liquidity',
    'exposure',
    'badDebt',
    'utilization',
    'supplyCapUsage',
    'borrowCapUsage',
    'supplyApy',
    'borrowApy'
  ],
  config: ['supplyCap', 'borrowCap', 'irmType', 'interestFee', 'maxLiqDiscount', 'badDebtSocialized', 'hooks', 'governor']
} as const;

const attributeLabels: Record<string, string> = {
  totalSupply: 'Total supply',
  totalBorrow: 'Total borrows',
  liquidity: 'Available liquidity',
  exposure: 'Current exposure',
  badDebt: 'Pending bad debt',
  utilization: 'Utilization',
  supplyCapUsage: 'Supply cap usage',
  borrowCapUsage: 'Borrow cap usage',
  supplyApy: 'Supply APY',
  borrowApy: 'Borrow APY',
  supplyCap: 'Supply cap',
  borrowCap: 'Borrow cap',
  irmType: 'Interest rate model',
  interestFee: 'Interest fee',
  maxLiqDiscount: 'Max liquidation discount',
  badDebtSocialized: 'Bad debt socialization',
  hooks: 'Hooked operations',
  governor: 'Governor'
};

function attributeValue(
  id: string,
  vault: NormalizedVault,
  rawVault: unknown
): { display: string; progress?: number | null; hint?: string } {
  const raw = record(rawVault);
  const caps = record(raw.caps);
  const fees = record(raw.fees);
  const liquidation = record(raw.liquidation);
  const totalBorrowed = raw.totalBorrowed ?? raw.totalBorrows ?? 0;
  const totalSupplyUsd = numberValue(raw.totalSupplyUsd);
  const totalBorrowUsd = numberValue(raw.totalBorrowsUsd);
  const liquidityUsd = Math.max(totalSupplyUsd - totalBorrowUsd, 0);
  const supplyCap = caps.supplyCap ?? raw.supplyCap;
  const borrowCap = caps.borrowCap ?? raw.borrowCap;

  switch (id) {
    case 'totalSupply':
      return { display: totalSupplyUsd ? `$${formatShortUSDS(totalSupplyUsd)}` : '—' };
    case 'totalBorrow':
      return { display: totalBorrowUsd ? `$${formatShortUSDS(totalBorrowUsd)}` : '—' };
    case 'liquidity':
      return { display: liquidityUsd ? `$${formatShortUSDS(liquidityUsd)}` : '—' };
    case 'exposure':
      return {
        display: vault.collaterals.length ? `${vault.collaterals.length} asset${vault.collaterals.length === 1 ? '' : 's'}` : '—'
      };
    case 'badDebt':
      return { display: '$0' };
    case 'utilization':
      return { display: displayPercent(vault.utilization) };
    case 'supplyCapUsage': {
      const progress = capUsage(raw.totalAssets, supplyCap);
      return { display: progress == null ? '—' : progress > 100 ? '>100%' : displayPercent(progress), progress };
    }
    case 'borrowCapUsage': {
      const progress = capUsage(totalBorrowed, borrowCap);
      return { display: progress == null ? '—' : progress > 100 ? '>100%' : displayPercent(progress), progress };
    }
    case 'supplyApy':
      return { display: displayPercent(vault.supplyApy) };
    case 'borrowApy':
      return { display: vault.collaterals.length ? displayPercent(vault.borrowApy) : '—' };
    case 'supplyCap':
      return { display: displayCap(supplyCap, vault, rawVault) };
    case 'borrowCap':
      return { display: vault.collaterals.length ? displayCap(borrowCap, vault, rawVault) : '—' };
    case 'irmType':
      return { display: vault.collaterals.length ? interestRateModel(rawVault) : '—' };
    case 'interestFee':
      return { display: vault.collaterals.length ? displayPercent(numberValue(fees.interestFee) * 100) : '—' };
    case 'maxLiqDiscount':
      return {
        display: vault.collaterals.length ? displayPercent(numberValue(liquidation.maxLiquidationDiscount) * 100) : '—'
      };
    case 'badDebtSocialized':
      return { display: vault.collaterals.length ? (liquidation.socializeDebt ? 'Yes' : 'No') : '—' };
    case 'hooks':
      return { display: hookedOperations(rawVault) };
    case 'governor': {
      const governor = raw.governorAdmin ?? raw.governor;
      return { display: typeof governor === 'string' ? shortenAddress(governor) : '—', hint: String(governor ?? '') };
    }
    default:
      return { display: '—' };
  }
}

export function DiscoveryMatrix(props: DiscoveryMatrixProps) {
  return props.view === 'stats' || props.view === 'config' ? <AttributeMatrix {...props} view={props.view} /> : <PairMatrix {...props} />;
}

function AttributeMatrix({
  chainId,
  market,
  view,
  rawVaultByAddress,
  selectedHeader,
  onSelectHeader
}: DiscoveryMatrixProps & { view: 'stats' | 'config' }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState<{ vault: string; attribute: string } | null>(null);
  const vaults = [...market.vaults, ...market.externalVaults].sort((a, b) => {
    const externalDifference = Number(market.externalVaults.includes(a)) - Number(market.externalVaults.includes(b));
    return externalDifference || a.asset.symbol.localeCompare(b.asset.symbol);
  });
  const attributes = attributeIds[view];

  return (
    <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <Box
        sx={{
          position: 'relative',
          maxWidth: '100%',
          maxHeight: '60vh',
          overflow: 'auto',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          overscrollBehavior: 'contain',
          scrollbarWidth: 'thin',
          scrollbarColor: `${theme.palette.grey[700]} transparent`,
          '&::-webkit-scrollbar': { width: 8, height: 8 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'grey.700', borderRadius: 1 },
          '&::-webkit-scrollbar-track': { bgcolor: 'action.hover' }
        }}
      >
        <Table stickyHeader size="small" sx={{ minWidth: 880, borderCollapse: 'separate' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 4, minWidth: 132, bgcolor: 'background.paper' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  Attribute →
                  <br />
                  Vault ↓
                </Typography>
              </TableCell>
              {attributes.map((attribute) => (
                <TableCell
                  key={attribute}
                  align="center"
                  sx={{
                    whiteSpace: 'nowrap',
                    bgcolor: hovered?.attribute === attribute ? alpha(theme.palette.common.white, 0.06) : 'background.paper'
                  }}
                >
                  {attributeLabels[attribute]}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {vaults.map((vault) => {
              const isExternal = market.externalVaults.includes(vault);
              const rowHighlighted =
                hovered?.vault === vault.address || (selectedHeader?.axis === 'row' && selectedHeader.address === vault.address);
              return (
                <TableRow key={vault.address}>
                  <TableCell
                    role="button"
                    tabIndex={0}
                    aria-label={`Select ${vault.asset.symbol} vault`}
                    onClick={() => onSelectHeader({ address: vault.address, axis: 'row' })}
                    sx={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      bgcolor:
                        selectedHeader?.axis === 'row' && selectedHeader.address === vault.address
                          ? alpha(theme.palette.secondary.main, 0.14)
                          : rowHighlighted
                            ? alpha(theme.palette.common.white, 0.06)
                            : 'background.paper',
                      color: isExternal ? 'text.disabled' : 'text.primary'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <TokenIcon
                        symbol={vault.asset.symbol}
                        logoUrl={tokenImageUrl(chainId, vault.asset.address)}
                        avatarProps={{ sx: { width: 18, height: 18, fontSize: 8 } }}
                      />
                      <Typography variant="body2">{vault.asset.symbol}</Typography>
                    </Box>
                  </TableCell>
                  {attributes.map((attribute) => {
                    const value = attributeValue(attribute, vault, rawVaultByAddress.get(vault.address));
                    const highlighted = rowHighlighted || hovered?.attribute === attribute;
                    return (
                      <TableCell
                        key={attribute}
                        align="center"
                        onMouseEnter={() => setHovered({ vault: vault.address, attribute })}
                        onMouseLeave={() => setHovered(null)}
                        sx={{ minWidth: 96, bgcolor: highlighted ? alpha(theme.palette.common.white, 0.06) : undefined }}
                      >
                        <Tooltip title={value.hint || ''}>
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.75 }}>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {value.display}
                            </Typography>
                            {value.progress != null && (
                              <CircularProgress
                                size={16}
                                thickness={5}
                                variant="determinate"
                                value={Math.min(Math.max(value.progress, 0), 100)}
                              />
                            )}
                          </Box>
                        </Tooltip>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      {!selectedHeader && (
        <Typography variant="body2" sx={{ textAlign: 'center' }}>
          Select a vault row to see lending/borrowing options below.
        </Typography>
      )}
    </Box>
  );
}

function PairMatrix({
  chainId,
  market,
  matrix,
  view,
  rawVaultByAddress,
  oracleMetadata,
  selectedCell,
  selectedHeader,
  onSelectCell,
  onSelectHeader
}: DiscoveryMatrixProps) {
  const theme = useTheme();
  const [hovered, setHovered] = useState<MatrixSelection | null>(null);
  const isCorrelated = (collateralAddress: string, liabilityAddress: string) => {
    const collateral = market.vaultByAddress.get(collateralAddress);
    const liability = market.vaultByAddress.get(liabilityAddress);
    return !!collateral && !!liability && sameRiskCategory(collateral, liability);
  };
  const range = getMatrixHeatmapRange(market, matrix, view, isCorrelated);

  return (
    <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <Box
        sx={{
          position: 'relative',
          maxWidth: '100%',
          maxHeight: '50vh',
          overflow: 'auto',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          overscrollBehavior: 'contain',
          scrollbarWidth: 'thin',
          scrollbarColor: `${theme.palette.grey[700]} transparent`,
          '&::-webkit-scrollbar': { width: 8, height: 8 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'grey.700', borderRadius: 1 },
          '&::-webkit-scrollbar-track': { bgcolor: 'action.hover' }
        }}
      >
        <Table stickyHeader size="small" sx={{ minWidth: Math.max(430, matrix.columns.length * 72 + 140), borderCollapse: 'separate' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 4, minWidth: 132, bgcolor: 'background.paper' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  Liability →
                  <br />
                  Collateral ↓
                </Typography>
              </TableCell>
              {matrix.columns.map((column) => {
                const highlighted =
                  hovered?.liabilityAddress === column.address ||
                  selectedCell?.liabilityAddress === column.address ||
                  (selectedHeader?.axis === 'column' && selectedHeader.address === column.address);
                return (
                  <TableCell
                    key={column.address}
                    align="center"
                    role="button"
                    tabIndex={0}
                    aria-label={`Select ${column.symbol} liability column`}
                    onClick={() => onSelectHeader({ address: column.address, axis: 'column' })}
                    sx={{
                      minWidth: 68,
                      cursor: 'pointer',
                      bgcolor:
                        selectedHeader?.axis === 'column' && selectedHeader.address === column.address
                          ? alpha(theme.palette.secondary.main, 0.14)
                          : highlighted
                            ? alpha(theme.palette.common.white, 0.06)
                            : 'background.paper'
                    }}
                  >
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                      <TokenIcon
                        symbol={column.symbol}
                        logoUrl={tokenImageUrl(chainId, column.assetAddress)}
                        avatarProps={{ sx: { width: 18, height: 18, fontSize: 8 } }}
                      />
                      <Typography variant="caption">{column.symbol}</Typography>
                    </Box>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {matrix.rows.map((row) => {
              const rowHighlighted =
                hovered?.collateralAddress === row.address ||
                selectedCell?.collateralAddress === row.address ||
                (selectedHeader?.axis === 'row' && selectedHeader.address === row.address);
              return (
                <TableRow key={row.address}>
                  <TableCell
                    role="button"
                    tabIndex={0}
                    aria-label={`Select ${row.symbol} collateral row`}
                    onClick={() => onSelectHeader({ address: row.address, axis: 'row' })}
                    sx={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      cursor: 'pointer',
                      bgcolor:
                        selectedHeader?.axis === 'row' && selectedHeader.address === row.address
                          ? alpha(theme.palette.secondary.main, 0.14)
                          : rowHighlighted
                            ? alpha(theme.palette.common.white, 0.06)
                            : 'background.paper',
                      color: row.category === 'borrowable' ? 'text.primary' : 'text.disabled'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <TokenIcon
                        symbol={row.symbol}
                        logoUrl={tokenImageUrl(chainId, row.assetAddress)}
                        avatarProps={{ sx: { width: 18, height: 18, fontSize: 8 } }}
                      />
                      <Typography variant="body2" noWrap>
                        {row.symbol}
                      </Typography>
                    </Box>
                  </TableCell>
                  {matrix.columns.map((column) => {
                    const cell = matrix.cells.get(row.address)?.get(column.address);
                    const correlated = isCorrelated(row.address, column.address);
                    const metric = cell ? getPairMetric(market, cell, view, correlated) : null;
                    const selected = selectedCell?.collateralAddress === row.address && selectedCell.liabilityAddress === column.address;
                    const highlighted =
                      rowHighlighted || hovered?.liabilityAddress === column.address || selectedCell?.liabilityAddress === column.address;
                    const rawLiability = rawVaultByAddress.get(column.address);
                    const oracle = oracleAddress(rawLiability);
                    const oracleLabel = oracle
                      ? String(record(oracleMetadata?.[oracle]).name ?? shortenAddress(oracle))
                      : 'Oracle metadata unavailable';

                    return (
                      <TableCell
                        key={column.address}
                        align="center"
                        role={cell ? 'button' : undefined}
                        tabIndex={cell ? 0 : -1}
                        aria-label={
                          metric?.state === 'unavailable' && metric.reason === 'uncorrelated-pair'
                            ? `${view === 'roe' ? 'Max ROE' : 'Max multiplier'} is unavailable for uncorrelated pairs`
                            : cell
                              ? `Select ${row.symbol} collateral and ${column.symbol} liability`
                              : undefined
                        }
                        onMouseEnter={() => setHovered({ collateralAddress: row.address, liabilityAddress: column.address })}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => cell && onSelectCell({ collateralAddress: row.address, liabilityAddress: column.address })}
                        sx={{
                          minWidth: 68,
                          cursor: cell ? 'pointer' : 'default',
                          bgcolor: selected
                            ? alpha(theme.palette.secondary.main, 0.2)
                            : highlighted
                              ? alpha(theme.palette.common.white, 0.06)
                              : metric?.state === 'available'
                                ? cellColor(metric.value, view, range.min, range.max)
                                : row.address === column.address
                                  ? alpha(theme.palette.common.white, 0.03)
                                  : undefined,
                          transition: 'background-color 0.15s'
                        }}
                      >
                        {cell && view === 'oracle' ? (
                          oracle ? (
                            <Tooltip title={oracleLabel}>
                              <AccountTreeOutlinedIcon sx={{ fontSize: 18, color: 'secondary.main' }} />
                            </Tooltip>
                          ) : (
                            <Typography variant="caption" color="text.disabled">
                              —
                            </Typography>
                          )
                        ) : metric?.state === 'available' ? (
                          <Typography
                            variant="caption"
                            sx={{
                              whiteSpace: 'nowrap',
                              fontWeight: selected ? 700 : 400,
                              color: selected ? 'secondary.main' : 'text.secondary'
                            }}
                          >
                            {view === 'lltv' && cell?.edge.isLiquidationLtvRamping && (
                              <Box component="span" sx={{ color: 'warning.main', mr: 0.25 }}>
                                ↘
                              </Box>
                            )}
                            {formatMetric(metric.value, view)}
                          </Typography>
                        ) : cell ? (
                          <Tooltip title={metric?.reason === 'uncorrelated-pair' ? 'Only available for correlated asset pairs.' : ''}>
                            <Typography variant="caption" color="text.disabled">
                              —
                            </Typography>
                          </Tooltip>
                        ) : null}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      {!selectedCell && !selectedHeader && (
        <Typography variant="body2" sx={{ textAlign: 'center' }}>
          Select a cell, row, or column header to see lending/borrowing options below.
        </Typography>
      )}
    </Box>
  );
}
