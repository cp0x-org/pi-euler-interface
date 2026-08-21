import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, CircularProgress, Grid, Paper, Stack, Tab, Tabs, Typography, useTheme } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';

import { fetchAccountPortfolio, tokenImageUrl } from '@/api/euler';
import { getRuntimeConfig } from '@/appconfig/runtime';
import ChainFilter, { ChainFilterValue } from 'components/ChainFilter';
import { ChainBadge } from 'components/ChainIcon';
import ConnectButtonCustom from 'components/ConnectButtonCustom';
import { TokenIcon } from 'components/TokenIcon';
import { useCopyToClipboard } from 'hooks/useCopyToClipboard';
import useTranslate from 'hooks/useTranslate';
import { EulerBorrowPosition, EulerDepositPosition } from 'types/euler';
import { formatShortUSDS } from 'utils/formatters';

type ChainedBorrowPosition = EulerBorrowPosition & { chainId: number };
type ChainedDepositPosition = EulerDepositPosition & { chainId: number };

function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${formatShortUSDS(value)}`;
}
function rawAmount(raw: string, decimals: number): number {
  try {
    return Number(formatUnits(BigInt(raw), decimals));
  } catch {
    return 0;
  }
}
function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '-';
}
function fixed1e18(value: string): number {
  try {
    return Number(formatUnits(BigInt(value), 18));
  } catch {
    return 0;
  }
}

export default function PortfolioPage() {
  const theme = useTheme();
  const t = useTranslate();
  const navigate = useNavigate();
  const copy = useCopyToClipboard();
  const { address } = useAccount();
  const { chains } = getRuntimeConfig();
  const [tab, setTab] = useState(0);
  const [chainFilter, setChainFilter] = useState<ChainFilterValue>('all');

  const portfolioQueries = useQueries({
    queries: chains.map((chain) => ({
      queryKey: ['euler', 'portfolio', chain.chainId, address],
      enabled: Boolean(address),
      queryFn: async () => ({
        chainId: chain.chainId,
        response: await fetchAccountPortfolio(chain.chainId, address as string)
      }),
      refetchInterval: 30_000
    }))
  });

  const healthColor = (hf: number) =>
    hf >= 2 ? theme.palette.success.main : hf >= 1.25 ? theme.palette.warning.main : theme.palette.error.main;

  if (!address)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 360, textAlign: 'center', gap: 2 }}>
        <Typography variant="h2">{t('portfolio.yourPortfolio', 'Your portfolio')}</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
          {t('portfolio.connectPrompt', 'Connect your wallet to view your Euler borrow positions and deposits, and to manage them.')}
        </Typography>
        <ConnectButtonCustom />
      </Box>
    );

  if (portfolioQueries.some((query) => query.isPending))
    return (
      <Box role="status" aria-live="polite" sx={{ display: 'grid', placeItems: 'center', minHeight: 420 }}>
        <CircularProgress aria-label={t('portfolio.loading', 'Loading portfolio')} />
      </Box>
    );

  const selectedPortfolioQueries = portfolioQueries.filter((_, index) => chainFilter === 'all' || chains[index]?.chainId === chainFilter);
  const successfulPortfolios = selectedPortfolioQueries.flatMap((query) => {
    const data = query.data;
    const portfolio = data?.response.data?.portfolio;
    return data && portfolio ? [{ chainId: data.chainId, portfolio }] : [];
  });
  const failedQueryCount = selectedPortfolioQueries.filter((query) => query.isError).length;

  const totals = successfulPortfolios.reduce(
    (aggregate, { portfolio }) => {
      const suppliedValueUsd = portfolio.totals?.suppliedValueUsd ?? 0;
      const netApy = portfolio.totals?.netApy ?? 0;
      return {
        suppliedValueUsd: aggregate.suppliedValueUsd + suppliedValueUsd,
        borrowedValueUsd: aggregate.borrowedValueUsd + (portfolio.totals?.borrowedValueUsd ?? 0),
        netAssetValueUsd: aggregate.netAssetValueUsd + (portfolio.totals?.netAssetValueUsd ?? 0),
        weightedNetApy: aggregate.weightedNetApy + suppliedValueUsd * netApy
      };
    },
    { suppliedValueUsd: 0, borrowedValueUsd: 0, netAssetValueUsd: 0, weightedNetApy: 0 }
  );
  const aggregateNetApy = totals.suppliedValueUsd > 0 ? totals.weightedNetApy / totals.suppliedValueUsd : 0;
  const borrows: ChainedBorrowPosition[] = successfulPortfolios.flatMap(({ chainId, portfolio }) =>
    (portfolio.borrows ?? []).map((position) => ({ ...position, chainId }))
  );
  const deposits: ChainedDepositPosition[] = successfulPortfolios.flatMap(({ chainId, portfolio }) =>
    (portfolio.savings ?? []).map((deposit) => ({ ...deposit, chainId }))
  );
  const emptyScope =
    chainFilter === 'all' ? t('portfolio.scope.allNetworks', 'across all networks') : t('portfolio.scope.thisNetwork', 'on this network');

  return (
    <Box sx={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginBottom: 2.5, flexWrap: 'wrap' }}>
        <Typography variant="h2">{t('portfolio.title', 'Portfolio')}</Typography>
        <Chip
          size="small"
          variant="outlined"
          label={shortAddress(address)}
          aria-label={t('portfolio.copyAddress', 'Copy connected wallet address {address}', { address: shortAddress(address) })}
          onDelete={() => copy.copyToClipboard(address)}
          deleteIcon={<ContentCopyIcon sx={{ fontSize: 15 }} />}
        />
        <Box sx={{ width: { xs: '100%', sm: 200 }, maxWidth: 220, marginLeft: { sm: 'auto' } }}>
          <ChainFilter value={chainFilter} onChange={setChainFilter} />
        </Box>
      </Box>

      {failedQueryCount > 0 && (
        <Alert severity="warning" sx={{ marginBottom: 2 }}>
          {failedQueryCount === 1
            ? t('portfolio.networkFailedOne', 'One network could not be loaded.')
            : t('portfolio.networkFailedMany', '{count} networks could not be loaded.', { count: failedQueryCount })}
          {successfulPortfolios.length > 0
            ? ` ${t('portfolio.showingResponded', 'Showing portfolio data from the selected networks that responded.')}`
            : ` ${t('portfolio.noDataForScope', 'No portfolio data is available for the selected network scope.')}`}
        </Alert>
      )}

      {/* Summary */}
      <Grid container spacing={2} sx={{ marginBottom: 3 }}>
        <SummaryStat label={t('portfolio.netWorth', 'Net worth')} value={fmtUsd(totals.netAssetValueUsd)} />
        <SummaryStat label={t('portfolio.supplied', 'Supplied')} value={fmtUsd(totals.suppliedValueUsd)} />
        <SummaryStat label={t('portfolio.borrowed', 'Borrowed')} value={fmtUsd(totals.borrowedValueUsd)} />
        <SummaryStat
          label={t('common.netApy', 'Net APY')}
          value={`${aggregateNetApy.toFixed(2)}%`}
          valueColor={aggregateNetApy >= 0 ? theme.palette.success.main : theme.palette.error.main}
        />
      </Grid>

      <Paper sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1, overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          aria-label={t('portfolio.tabsLabel', 'Portfolio sections')}
          sx={{ borderBottom: `1px solid ${theme.palette.divider}`, px: 1 }}
        >
          <Tab label={`${t('portfolio.positions', 'Positions')}${borrows.length ? ` (${borrows.length})` : ''}`} />
          <Tab label={`${t('portfolio.deposits', 'Deposits')}${deposits.length ? ` (${deposits.length})` : ''}`} />
        </Tabs>
        <Box sx={{ padding: { xs: 1.5, sm: 2.5 } }}>
          {tab === 0 ? (
            borrows.length === 0 ? (
              <EmptyState text={t('portfolio.emptyPositions', 'You have no open borrow positions {scope}.', { scope: emptyScope })} />
            ) : (
              <Stack spacing={1.5}>
                {borrows.map((position) => (
                  <PositionRow
                    key={`${position.chainId}-${position.collateralVault.address}-${position.borrowVault.address}-${position.subAccount}`}
                    position={position}
                    healthColor={healthColor}
                    onManage={() =>
                      navigate(
                        `/portfolio/position/${position.collateralVault.address}/${position.borrowVault.address}?network=${position.chainId}`
                      )
                    }
                  />
                ))}
              </Stack>
            )
          ) : deposits.length === 0 ? (
            <EmptyState text={t('portfolio.emptyDeposits', 'You have no deposits {scope}.', { scope: emptyScope })} />
          ) : (
            <Stack spacing={1.5}>
              {deposits.map((deposit) => (
                <DepositRow
                  key={`${deposit.chainId}-${deposit.vault.address}-${deposit.subAccount}`}
                  deposit={deposit}
                  onSupply={() => navigate(depositHref(deposit, deposit.chainId, 'supply'))}
                  onWithdraw={() => navigate(depositHref(deposit, deposit.chainId, 'withdraw'))}
                />
              ))}
            </Stack>
          )}
        </Box>
      </Paper>
    </Box>
  );
}

function depositHref(deposit: EulerDepositPosition, chainId: number, action: 'supply' | 'withdraw'): string {
  const isEarn = deposit.vault.type === 'EulerEarn';
  const base = isEarn ? `/earn/vault/${deposit.vault.address}` : `/lend/${deposit.vault.address}`;
  return `${base}?network=${chainId}&action=${action}`;
}

function SummaryStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const theme = useTheme();
  return (
    <Grid size={{ xs: 6, md: 3 }}>
      <Paper sx={{ padding: 2, border: `1px solid ${theme.palette.divider}`, borderRadius: 1, height: '100%' }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h3" sx={{ marginTop: 0.5, color: valueColor }}>
          {value}
        </Typography>
      </Paper>
    </Grid>
  );
}

function PositionRow({
  position,
  healthColor,
  onManage
}: {
  position: ChainedBorrowPosition;
  healthColor: (hf: number) => string;
  onManage: () => void;
}) {
  const theme = useTheme();
  const t = useTranslate();
  const collateral = position.collateralVault;
  const borrow = position.borrowVault;
  const hf = fixed1e18(position.healthFactor);
  const ltv = fixed1e18(position.currentLTV) * 100;
  const netValue = (position.totalCollateralValueUsd ?? 0) - (position.liabilityValueUsd ?? 0);
  return (
    <Paper
      variant="outlined"
      onClick={onManage}
      sx={{
        padding: 2,
        borderRadius: 1,
        borderColor: theme.palette.divider,
        cursor: 'pointer',
        transition: 'border-color .15s',
        '&:hover': { borderColor: theme.palette.secondary.main }
      }}
    >
      <Grid container spacing={2} alignItems="center">
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TokenIcon
              symbol={collateral.asset.symbol}
              logoUrl={tokenImageUrl(position.chainId, collateral.asset.address)}
              avatarProps={{ sx: { width: 32, height: 32, fontSize: 11 } }}
            />
            <ArrowForwardIcon sx={{ fontSize: 16, color: theme.palette.grey[500] }} />
            <TokenIcon
              symbol={borrow.asset.symbol}
              logoUrl={tokenImageUrl(position.chainId, borrow.asset.address)}
              avatarProps={{ sx: { width: 32, height: 32, fontSize: 11 } }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" noWrap>
                {collateral.asset.symbol} → {borrow.asset.symbol}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('portfolio.borrowPosition', 'Borrow position')}
              </Typography>
              <ChainBadge
                chainId={position.chainId}
                sx={{ height: 20, marginTop: 0.5, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
              />
            </Box>
          </Box>
        </Grid>
        <Metric label={t('portfolio.netValue', 'Net value')} value={fmtUsd(netValue)} />
        <Metric label={t('common.debt', 'Debt')} value={fmtUsd(position.liabilityValueUsd ?? 0)} />
        <Metric
          label={t('common.health', 'Health')}
          value={Number.isFinite(hf) && hf > 0 ? hf.toFixed(2) : '∞'}
          valueColor={healthColor(hf)}
        />
        <Metric
          label={t('common.netApy', 'Net APY')}
          value={`${(position.netApy ?? 0).toFixed(2)}%`}
          valueColor={(position.netApy ?? 0) >= 0 ? theme.palette.success.main : theme.palette.error.main}
          extra={t('common.ltvValue', 'LTV {value}%', { value: ltv.toFixed(1) })}
        />
        <Grid size={{ xs: 12, md: 1 }} sx={{ textAlign: { md: 'right' } }}>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            onClick={(event) => {
              event.stopPropagation();
              onManage();
            }}
            aria-label={t('portfolio.managePosition', 'Manage {collateral} to {borrow} borrow position', {
              collateral: collateral.asset.symbol,
              borrow: borrow.asset.symbol
            })}
          >
            {t('portfolio.manage', 'Manage')}
          </Button>
        </Grid>
      </Grid>
    </Paper>
  );
}

function DepositRow({ deposit, onSupply, onWithdraw }: { deposit: ChainedDepositPosition; onSupply: () => void; onWithdraw: () => void }) {
  const theme = useTheme();
  const t = useTranslate();
  const isEarn = deposit.vault.type === 'EulerEarn';
  const assets = rawAmount(deposit.assets, deposit.vault.asset.decimals);
  return (
    <Paper variant="outlined" sx={{ padding: 2, borderRadius: 1, borderColor: theme.palette.divider }}>
      <Grid container spacing={2} alignItems="center">
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TokenIcon
              symbol={deposit.vault.asset.symbol}
              logoUrl={tokenImageUrl(deposit.chainId, deposit.vault.asset.address)}
              avatarProps={{ sx: { width: 32, height: 32, fontSize: 11 } }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="h5" noWrap>
                  {deposit.vault.shares.symbol}
                </Typography>
                <Chip
                  label={isEarn ? t('nav.earn', 'Earn') : t('nav.lend', 'Lend')}
                  size="small"
                  color={isEarn ? 'secondary' : 'default'}
                  variant="outlined"
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                {deposit.vault.asset.symbol}
              </Typography>
              <ChainBadge
                chainId={deposit.chainId}
                sx={{ height: 20, marginTop: 0.5, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
              />
            </Box>
          </Box>
        </Grid>
        <Metric
          label={t('common.balance', 'Balance')}
          value={fmtUsd(deposit.suppliedValueUsd ?? 0)}
          extra={`${assets.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${deposit.vault.asset.symbol}`}
        />
        <Metric label={t('common.apy', 'APY')} value={`${(deposit.apy ?? 0).toFixed(2)}%`} valueColor={theme.palette.success.main} />
        <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: { md: 'right' } }}>
          <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
            <Button
              size="small"
              variant="contained"
              color="secondary"
              onClick={onSupply}
              aria-label={t('portfolio.supplyTo', 'Supply {symbol} to {vault}', {
                symbol: deposit.vault.asset.symbol,
                vault: deposit.vault.shares.symbol
              })}
            >
              {t('common.supply', 'Supply')}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              onClick={onWithdraw}
              aria-label={t('portfolio.withdrawFrom', 'Withdraw {symbol} from {vault}', {
                symbol: deposit.vault.asset.symbol,
                vault: deposit.vault.shares.symbol
              })}
            >
              {t('common.withdraw', 'Withdraw')}
            </Button>
          </Stack>
        </Grid>
      </Grid>
    </Paper>
  );
}

function Metric({ label, value, valueColor, extra }: { label: string; value: string; valueColor?: string; extra?: string }) {
  return (
    <Grid size={{ xs: 4, md: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ color: valueColor }}>
        {value}
      </Typography>
      {extra && (
        <Typography variant="caption" color="text.secondary">
          {extra}
        </Typography>
      )}
    </Grid>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 160, textAlign: 'center' }}>
      <Typography color="text.secondary">{text}</Typography>
    </Box>
  );
}
