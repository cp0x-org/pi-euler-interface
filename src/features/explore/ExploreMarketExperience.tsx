import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import FullscreenOutlinedIcon from '@mui/icons-material/FullscreenOutlined';
import FullscreenExitOutlinedIcon from '@mui/icons-material/FullscreenExitOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';

import { tokenImageUrl } from '@/api/euler';
import { TokenIcon } from 'components/TokenIcon';
import type { V3VaultDetail } from 'types/euler';

import {
  MATRIX_VIEW_OPTIONS,
  buildCollateralMatrix,
  buildGraphDiagram,
  resolveDiscoverySelection,
  type CollateralMatrix,
  type DiscoverySelection,
  type MatrixViewId
} from './calculations';
import { DiscoveryGraph } from './DiscoveryGraph';
import { DiscoveryMatrix, type HeaderSelection, type MatrixSelection } from './DiscoveryMatrix';
import { buildNormalizedMarket, getUnresolvedVaultAddresses, normalizeAddress, type NormalizedMarket } from './model';
import { fetchExploreOracleMetadata, fetchExploreSdkFallback } from './sdk';

interface ExploreMarketExperienceProps {
  chainId: number;
  marketId: string;
  memberAddresses: string[];
  vaults: V3VaultDetail[];
  onResolvedSummary?: (summary: ExploreResolvedSummary) => void;
}

type ViewMode = 'graph' | 'matrix';

export interface ExploreResolvedSummary {
  assetCount: number;
  pairCount: number;
  unknownVaults: number;
  totalSupplyUsd: number;
  totalBorrowedUsd: number;
  availableLiquidityUsd: number;
}

const rawRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const rawUsdValue = (rawVault: unknown, field: 'supply' | 'borrow') => {
  const raw = rawRecord(rawVault);
  const v3Value = Number(field === 'supply' ? raw.totalSupplyUsd : raw.totalBorrowsUsd);
  if (Number.isFinite(v3Value)) return v3Value;

  const rawAmount = field === 'supply' ? raw.totalAssets : (raw.totalBorrowed ?? raw.totalBorrows);
  const price = Number(raw.marketPriceUsd);
  const decimals = Number(rawRecord(raw.asset).decimals ?? 18);
  const amount = Number(rawAmount);
  return Number.isFinite(price) && Number.isFinite(amount) ? (amount / 10 ** decimals) * price : 0;
};

export default function ExploreMarketExperience({
  chainId,
  marketId,
  memberAddresses,
  vaults,
  onResolvedSummary
}: ExploreMarketExperienceProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ViewMode>('graph');
  const [fullscreen, setFullscreen] = useState(false);
  const [matrixView, setMatrixView] = useState<MatrixViewId>('stats');
  const [selectedGraphNode, setSelectedGraphNode] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<MatrixSelection | null>(null);
  const [selectedHeader, setSelectedHeader] = useState<HeaderSelection | null>(null);

  const fallbackAddresses = useMemo(() => {
    return getUnresolvedVaultAddresses(vaults, memberAddresses);
  }, [memberAddresses, vaults]);

  const fallbackQuery = useQuery({
    queryKey: ['euler', 'explore-sdk-fallback', chainId, fallbackAddresses],
    enabled: fallbackAddresses.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: () => fetchExploreSdkFallback(chainId, fallbackAddresses)
  });

  const oracleQuery = useQuery({
    queryKey: ['euler', 'explore-oracle-metadata', chainId],
    enabled: mode === 'matrix' && matrixView === 'oracle',
    staleTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: () => fetchExploreOracleMetadata(chainId)
  });

  const rawVaults = useMemo(() => [...vaults, ...(fallbackQuery.data?.vaults ?? [])], [vaults, fallbackQuery.data?.vaults]);
  const memberSet = useMemo(() => new Set(memberAddresses.map(normalizeAddress)), [memberAddresses]);
  const externalVaults = useMemo(
    () => (fallbackQuery.data?.vaults ?? []).filter((vault) => !memberSet.has(normalizeAddress(vault.address))),
    [fallbackQuery.data?.vaults, memberSet]
  );
  const market = useMemo(
    () => buildNormalizedMarket(rawVaults, memberAddresses, externalVaults),
    [rawVaults, memberAddresses, externalVaults]
  );
  const diagram = useMemo(() => buildGraphDiagram(market), [market]);
  const matrix = useMemo(() => buildCollateralMatrix(market), [market]);
  const rawVaultByAddress = useMemo(() => new Map(rawVaults.map((vault) => [normalizeAddress(vault.address), vault])), [rawVaults]);

  const resolvedSummary = useMemo<ExploreResolvedSummary>(() => {
    let totalSupplyUsd = 0;
    let totalBorrowedUsd = 0;
    for (const vault of market.vaults) {
      const rawVault = rawVaultByAddress.get(vault.address);
      totalSupplyUsd += rawUsdValue(rawVault, 'supply');
      totalBorrowedUsd += rawUsdValue(rawVault, 'borrow');
    }
    return {
      assetCount: diagram.assetCount,
      pairCount: diagram.pairCount,
      unknownVaults: Math.max(memberAddresses.length - market.vaults.length, 0),
      totalSupplyUsd,
      totalBorrowedUsd,
      availableLiquidityUsd: Math.max(totalSupplyUsd - totalBorrowedUsd, 0)
    };
  }, [diagram.assetCount, diagram.pairCount, market.vaults, memberAddresses.length, rawVaultByAddress]);

  // Latest-ref pattern: parents pass fresh inline callbacks each render, so the
  // notification effect must key on the summary data, not the callback identity.
  const onResolvedSummaryRef = useRef(onResolvedSummary);
  useEffect(() => {
    onResolvedSummaryRef.current = onResolvedSummary;
  });
  useEffect(() => {
    onResolvedSummaryRef.current?.(resolvedSummary);
  }, [resolvedSummary]);

  const setViewMode = (next: ViewMode | null) => {
    if (!next) return;
    setMode(next);
    setSelectedGraphNode(null);
    setSelectedCell(null);
    setSelectedHeader(null);
  };

  const selectMatrixView = (next: MatrixViewId) => {
    setMatrixView(next);
    setSelectedCell(null);
    setSelectedHeader(null);
  };

  if (!matrix) {
    return (
      <Stack spacing={1}>
        {fallbackQuery.isFetching ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              Resolving external vault metadata…
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No active collateral relationships are available for this market.
          </Typography>
        )}
        {fallbackQuery.isError && (
          <Typography variant="caption" color="text.disabled">
            On-chain fallback unavailable: {(fallbackQuery.error as Error).message}
          </Typography>
        )}
        {market.vaults.map((vault) => (
          <ResultRow
            key={vault.address}
            chainId={chainId}
            label={`Lend ${vault.asset.symbol}`}
            vault={vault}
            onClick={() => navigate(`/lend/${vault.address}?network=${chainId}`)}
          />
        ))}
      </Stack>
    );
  }

  return (
    <Box
      data-testid="explore-market-expanded"
      data-market-id={marketId}
      onClick={() => mode === 'graph' && setSelectedGraphNode(null)}
      sx={{
        mx: { xs: -1.5, sm: -2 },
        mb: -1,
        ...(fullscreen && {
          position: 'fixed',
          inset: 0,
          zIndex: theme.zIndex.modal,
          m: 0,
          p: { xs: 1, sm: 3 },
          bgcolor: 'background.default',
          overflow: 'auto'
        })
      }}
    >
      <Box
        onClick={(event) => event.stopPropagation()}
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, px: 2, pb: 1 }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_, next) => setViewMode(next)}
          sx={{
            '& .MuiToggleButton-root': {
              minHeight: 34,
              px: 1.25,
              py: 0.5,
              textTransform: 'none',
              borderColor: 'divider',
              '&.Mui-selected': {
                bgcolor: alpha(theme.palette.secondary.main, 0.15),
                color: 'secondary.main'
              }
            }
          }}
        >
          <ToggleButton value="graph">
            <HubOutlinedIcon sx={{ fontSize: 15, mr: 0.5 }} />
            Graph
          </ToggleButton>
          <ToggleButton value="matrix">
            <GridViewOutlinedIcon sx={{ fontSize: 15, mr: 0.5 }} />
            Matrix
          </ToggleButton>
        </ToggleButtonGroup>

        {mode === 'matrix' && (
          <Select
            size="small"
            value={matrixView}
            onChange={(event) => selectMatrixView(event.target.value as MatrixViewId)}
            sx={{ minWidth: 150, height: 34, borderRadius: 99, '& .MuiSelect-select': { py: 0.75, fontSize: 13 } }}
          >
            {MATRIX_VIEW_OPTIONS.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        )}

        {fallbackQuery.isFetching && (
          <Tooltip title="Resolving external vault metadata on-chain">
            <CircularProgress size={16} />
          </Tooltip>
        )}
        {mode === 'matrix' && matrixView === 'oracle' && oracleQuery.isFetching && (
          <Typography variant="caption" color="text.disabled">
            Loading oracle metadata…
          </Typography>
        )}
        <Tooltip title={fullscreen ? 'Exit expanded view' : 'Expand discovery view'}>
          <IconButton
            size="small"
            sx={{ ml: 'auto' }}
            onClick={(event) => {
              event.stopPropagation();
              setFullscreen((current) => !current);
            }}
          >
            {fullscreen ? <FullscreenExitOutlinedIcon fontSize="small" /> : <FullscreenOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Copy market link">
          <IconButton
            size="small"
            onClick={() =>
              navigator.clipboard?.writeText(`${window.location.origin}/explore?market=${encodeURIComponent(marketId)}&network=${chainId}`)
            }
          >
            <LinkOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {mode === 'matrix' && (matrixView === 'roe' || matrixView === 'multiplier') && (
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', pb: 1 }}>
          {matrixView === 'roe' ? 'Max ROE' : 'Max multiplier'} only shown for correlated pairs.
        </Typography>
      )}

      {mode === 'graph' ? (
        <DiscoveryGraph
          chainId={chainId}
          diagram={diagram}
          selectedAddress={selectedGraphNode}
          onSelect={(address) => setSelectedGraphNode((current) => (current === address ? null : address))}
        />
      ) : (
        <DiscoveryMatrix
          chainId={chainId}
          market={market}
          matrix={matrix}
          view={matrixView}
          rawVaultByAddress={rawVaultByAddress}
          oracleMetadata={oracleQuery.data}
          selectedCell={selectedCell}
          selectedHeader={selectedHeader}
          onSelectCell={(selection) => {
            setSelectedCell((current) =>
              current?.collateralAddress === selection.collateralAddress && current.liabilityAddress === selection.liabilityAddress
                ? null
                : selection
            );
            setSelectedHeader(null);
          }}
          onSelectHeader={(selection) => {
            setSelectedHeader((current) => (current?.address === selection.address && current.axis === selection.axis ? null : selection));
            setSelectedCell(null);
          }}
        />
      )}

      <SelectionResults
        chainId={chainId}
        market={market}
        matrix={matrix}
        mode={mode}
        matrixView={matrixView}
        graphAddress={selectedGraphNode}
        cell={selectedCell}
        header={selectedHeader}
      />

      {fallbackQuery.isError && fallbackAddresses.length > 0 && (
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', px: 2, pb: 1 }}>
          Some external vault metadata is unavailable; showing V3 market data.
        </Typography>
      )}
    </Box>
  );
}

function SelectionResults({
  chainId,
  market,
  matrix,
  mode,
  matrixView,
  graphAddress,
  cell,
  header
}: {
  chainId: number;
  market: NormalizedMarket;
  matrix: CollateralMatrix;
  mode: ViewMode;
  matrixView: MatrixViewId;
  graphAddress: string | null;
  cell: MatrixSelection | null;
  header: HeaderSelection | null;
}) {
  const navigate = useNavigate();
  const selection: DiscoverySelection | null =
    mode === 'graph' && graphAddress
      ? { kind: 'graph', address: graphAddress }
      : cell
        ? { kind: 'cell', ...cell }
        : header
          ? { kind: 'header', ...header }
          : null;
  if (!selection) return null;

  const resolved = resolveDiscoverySelection(market, matrix, selection);
  const lendVault = resolved.lendAddress ? market.vaultByAddress.get(resolved.lendAddress) : undefined;
  const borrowPairs = resolved.borrowPairs;

  return (
    <Box onClick={(event) => event.stopPropagation()} sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          borderColor: (theme) => alpha(theme.palette.secondary.main, 0.28),
          bgcolor: (theme) => alpha(theme.palette.secondary.main, 0.035)
        }}
      >
        {mode === 'matrix' && matrixView === 'oracle' && cell && (
          <Box sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2">Oracle route</Typography>
            <Typography variant="caption" color="text.secondary">
              {market.vaultByAddress.get(cell.collateralAddress)?.asset.symbol} collateral priced for{' '}
              {market.vaultByAddress.get(cell.liabilityAddress)?.asset.symbol} liability.
            </Typography>
          </Box>
        )}
        <Stack spacing={1.5}>
          {lendVault && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                Lend
              </Typography>
              <ResultRow
                chainId={chainId}
                label={`Lend ${lendVault.asset.symbol}`}
                vault={lendVault}
                onClick={() => navigate(`/lend/${lendVault.address}?network=${chainId}`)}
              />
            </Box>
          )}
          {borrowPairs.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                Borrow
              </Typography>
              <Stack spacing={0.75}>
                {borrowPairs.map((pair) => {
                  const collateral = market.vaultByAddress.get(pair.collateralAddress);
                  const liability = market.vaultByAddress.get(pair.liabilityAddress);
                  if (!collateral || !liability) return null;
                  const edge = matrix.cells.get(pair.collateralAddress)?.get(pair.liabilityAddress)?.edge;
                  return (
                    <ResultRow
                      key={`${pair.collateralAddress}:${pair.liabilityAddress}`}
                      chainId={chainId}
                      label={`Borrow ${liability.asset.symbol} against ${collateral.asset.symbol}`}
                      vault={liability}
                      trailing={edge ? `${(edge.borrowLtv * 100).toFixed(1)}% LTV` : undefined}
                      onClick={() => navigate(`/borrow/${pair.collateralAddress}/${pair.liabilityAddress}?network=${chainId}`)}
                    />
                  );
                })}
              </Stack>
            </Box>
          )}
          {lendVault && borrowPairs.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              This vault is used as collateral only and does not support borrowing.
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}

function ResultRow({
  chainId,
  label,
  vault,
  trailing,
  onClick
}: {
  chainId: number;
  label: string;
  vault: NormalizedMarket['vaults'][number];
  trailing?: string;
  onClick: () => void;
}) {
  return (
    <Button
      fullWidth
      color="inherit"
      onClick={onClick}
      sx={{
        justifyContent: 'flex-start',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        px: 1.25,
        py: 0.8,
        textTransform: 'none',
        '&:hover': { borderColor: 'secondary.main', bgcolor: 'action.hover' }
      }}
    >
      <TokenIcon
        symbol={vault.asset.symbol}
        logoUrl={tokenImageUrl(chainId, vault.asset.address)}
        avatarProps={{ sx: { width: 24, height: 24, fontSize: 9 } }}
      />
      <Typography variant="body2" sx={{ ml: 1, textAlign: 'left' }}>
        {label}
      </Typography>
      {trailing && <Chip size="small" variant="outlined" label={trailing} sx={{ ml: 'auto' }} />}
      <ArrowForwardIcon sx={{ ml: trailing ? 1 : 'auto', fontSize: 16, color: 'secondary.main' }} />
    </Button>
  );
}
