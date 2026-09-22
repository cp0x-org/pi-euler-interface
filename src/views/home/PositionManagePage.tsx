import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Address, Hex, decodeFunctionResult, encodeFunctionData, formatUnits, isAddress } from 'viem';
import { useAccount } from 'wagmi';

import { fetchAccountPortfolio, fetchPrices, fetchVaultsBatch, rpcCall, tokenImageUrl } from '@/api/euler';
import { useNetworkParam } from 'hooks/useNetworkParam';
import { ERC20_ABI, ERC4626_ABI } from '@/contracts/erc4626';
import BorrowForm from 'components/BorrowForm';
import RepayForm from 'components/RepayForm';
import VaultActionForm from 'components/VaultActionForm';
import ConnectButtonCustom from 'components/ConnectButtonCustom';
import { TokenIcon } from 'components/TokenIcon';
import YieldBreakdownInfo from 'components/YieldBreakdownInfo';
import { useCopyToClipboard } from 'hooks/useCopyToClipboard';
import useTranslate from 'hooks/useTranslate';
import { formatShortUSDS } from 'utils/formatters';

// Refinance (moving debt to another market) is deferred like Multiply — the tab stays hidden until
// the target-market picker + multi-controller EVC batch land. Flip to re-enable.
const SHOW_REFINANCE = false;

function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${formatShortUSDS(value)}`;
}
function fmtPct(value?: number): string {
  return Number.isFinite(value) ? `${(value as number).toFixed(2)}%` : '—';
}
function fixed1e18(value?: string): number {
  if (!value) return 0;
  try {
    return Number(formatUnits(BigInt(value), 18));
  } catch {
    return 0;
  }
}
function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '-';
}

// Escrow collateral vaults expose no metrics in the batch payload; read the underlying token
// straight from the chain so the pair renders and can transact.
async function resolveCollateralAsset(
  chainId: number,
  vault: string
): Promise<{ address: string; symbol: string; decimals: number } | null> {
  try {
    const assetResult = await rpcCall<Hex>(chainId, 'eth_call', [
      { to: vault, data: encodeFunctionData({ abi: ERC4626_ABI, functionName: 'asset' }) },
      'latest'
    ]);
    const assetAddress = decodeFunctionResult({ abi: ERC4626_ABI, functionName: 'asset', data: assetResult }) as Address;
    const [symbolResult, decimalsResult] = await Promise.all([
      rpcCall<Hex>(chainId, 'eth_call', [
        { to: assetAddress, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'symbol' }) },
        'latest'
      ]),
      rpcCall<Hex>(chainId, 'eth_call', [
        { to: assetAddress, data: encodeFunctionData({ abi: ERC4626_ABI, functionName: 'decimals' }) },
        'latest'
      ])
    ]);
    const symbol = decodeFunctionResult({ abi: ERC20_ABI, functionName: 'symbol', data: symbolResult }) as string;
    const decimals = Number(decodeFunctionResult({ abi: ERC4626_ABI, functionName: 'decimals', data: decimalsResult }));
    return { address: assetAddress, symbol, decimals };
  } catch {
    return null;
  }
}

export default function PositionManagePage() {
  const theme = useTheme();
  const t = useTranslate();
  const navigate = useNavigate();
  const copy = useCopyToClipboard();
  const { address } = useAccount();
  const { collateral = '', liability = '' } = useParams<{ collateral: string; liability: string }>();
  const [params] = useSearchParams();
  const { chainId } = useNetworkParam();
  const valid = isAddress(collateral) && isAddress(liability);

  const tabParam = { repay: 0, borrow: 1, add: 2, remove: 3 }[params.get('tab') ?? 'repay'] ?? 0;
  const [tab, setTab] = useState(tabParam);

  const vaultsQuery = useQuery({
    queryKey: ['euler', 'borrow-detail', chainId, collateral, liability],
    enabled: valid,
    queryFn: () => fetchVaultsBatch(chainId, [collateral, liability])
  });
  const portfolioQuery = useQuery({
    queryKey: ['euler', 'portfolio', chainId, address],
    enabled: Boolean(address),
    queryFn: () => fetchAccountPortfolio(chainId, address as string),
    refetchInterval: 30_000
  });

  const borrowVault = vaultsQuery.data?.data?.find((vault) => vault.address.toLowerCase() === liability.toLowerCase());
  const collateralVault = vaultsQuery.data?.data?.find((vault) => vault.address.toLowerCase() === collateral.toLowerCase());
  const collateralConfig = borrowVault?.collaterals?.find((item) => item.collateral.toLowerCase() === collateral.toLowerCase());

  // The same (collateral, liability) pair can be open on several sub-accounts, so the row that
  // linked here passes its own `sub`; without it fall back to the first match.
  const subAccount = params.get('sub');
  const position = useMemo(() => {
    const matches = (portfolioQuery.data?.data?.portfolio?.borrows ?? []).filter(
      (entry) =>
        entry.borrowVault.address.toLowerCase() === liability.toLowerCase() &&
        entry.collateralVault.address.toLowerCase() === collateral.toLowerCase()
    );
    return matches.find((entry) => entry.subAccount?.toLowerCase() === subAccount?.toLowerCase()) ?? matches[0];
  }, [portfolioQuery.data, collateral, liability, subAccount]);

  const hasCollateralAsset = Boolean(position?.collateralVault.asset) || Boolean(collateralConfig?.asset) || Boolean(collateralVault);
  const resolvedCollateralQuery = useQuery({
    queryKey: ['euler', 'position-collateral-asset', chainId, collateral],
    enabled: valid && Boolean(borrowVault) && !hasCollateralAsset,
    queryFn: () => resolveCollateralAsset(chainId, collateral)
  });

  const collateralAssetAddress =
    position?.collateralVault.asset.address ||
    collateralConfig?.asset ||
    collateralVault?.asset.address ||
    resolvedCollateralQuery.data?.address;
  const collateralSymbol =
    position?.collateralVault.asset.symbol ||
    collateralConfig?.assetSymbol ||
    collateralVault?.asset.symbol ||
    resolvedCollateralQuery.data?.symbol ||
    t('common.collateral', 'Collateral');
  const collateralDecimals =
    position?.collateralVault.asset.decimals ??
    collateralConfig?.assetDecimals ??
    collateralVault?.asset.decimals ??
    resolvedCollateralQuery.data?.decimals;

  const pricesQuery = useQuery({
    queryKey: ['euler', 'position-prices', chainId, collateralAssetAddress, borrowVault?.asset.address],
    enabled: Boolean(collateralAssetAddress && borrowVault),
    queryFn: () => fetchPrices(chainId, [collateralAssetAddress as string, borrowVault!.asset.address])
  });
  const priceByAddress = useMemo(() => {
    const map = new Map<string, number>();
    for (const price of pricesQuery.data?.data ?? []) map.set(price.address.toLowerCase(), price.priceUsd);
    return map;
  }, [pricesQuery.data]);
  const collateralPrice = collateralAssetAddress ? (priceByAddress.get(collateralAssetAddress.toLowerCase()) ?? 0) : 0;
  const borrowPrice = borrowVault ? (priceByAddress.get(borrowVault.asset.address.toLowerCase()) ?? 0) : 0;

  const borrowLtv = collateralConfig ? Number(collateralConfig.borrowLTV) / 10_000 : (position?.borrowLTV ?? 0);
  const liquidationLtv = collateralConfig ? Number(collateralConfig.liquidationLTV) / 10_000 : (position?.liquidationLTV ?? 0);
  const collateralSupplyApy = collateralVault?.supplyApy ?? position?.collateralVault.supplyApy ?? 0;
  const availableLiquidityUsd = borrowVault ? Math.max((borrowVault.totalSupplyUsd || 0) - (borrowVault.totalBorrowsUsd || 0), 0) : 0;

  const refetchAll = () => {
    void vaultsQuery.refetch();
    void portfolioQuery.refetch();
  };

  const healthColor = (hf: number) =>
    hf >= 2 ? theme.palette.success.main : hf >= 1.25 ? theme.palette.warning.main : theme.palette.error.main;

  if (!valid)
    return (
      <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}` }}>
        <Typography color="error">{t('position.invalidPair', 'Invalid position address pair.')}</Typography>
        <Button sx={{ marginTop: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate(`/portfolio?network=${chainId}`)}>
          {t('position.back', 'Back to Portfolio')}
        </Button>
      </Paper>
    );
  if (!address)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 320, textAlign: 'center', gap: 2 }}>
        <Typography variant="h3">{t('position.connectPrompt', 'Connect your wallet to manage this position.')}</Typography>
        <ConnectButtonCustom />
      </Box>
    );
  if (vaultsQuery.isLoading)
    return (
      <Box role="status" aria-live="polite" sx={{ display: 'grid', placeItems: 'center', minHeight: 420 }}>
        <CircularProgress aria-label={t('position.loading', 'Loading position')} />
      </Box>
    );
  if (vaultsQuery.error || !borrowVault || !collateralConfig)
    return (
      <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}` }}>
        <Typography color="error">
          {t('position.collateralNotAccepted', 'This collateral is not accepted by the selected market.')}
        </Typography>
        <Button sx={{ marginTop: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate(`/portfolio?network=${chainId}`)}>
          {t('position.back', 'Back to Portfolio')}
        </Button>
      </Paper>
    );

  const hf = fixed1e18(position?.healthFactor);
  const currentLtv = fixed1e18(position?.currentLTV) * 100;
  // `roe` is the API's return on equity (netApy x leverage); fall back to the gross net APY when absent.
  const positionRoe = Number.isFinite(position?.roe) ? (position?.roe as number) : (position?.netApy ?? 0);
  const positionLeverage = Number.isFinite(position?.multiplier) ? `${(position?.multiplier as number).toFixed(2)}x` : '—';

  return (
    <Box sx={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, marginBottom: 2.5 }}>
        <IconButton onClick={() => navigate(`/portfolio?network=${chainId}`)} aria-label={t('position.back', 'Back to Portfolio')}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <TokenIcon
            symbol={collateralSymbol}
            logoUrl={collateralAssetAddress ? tokenImageUrl(chainId, collateralAssetAddress) : ''}
            avatarProps={{ sx: { width: 40, height: 40, fontSize: 12 } }}
          />
          <ArrowForwardIcon sx={{ fontSize: 18, color: theme.palette.grey[500], mx: 0.5 }} />
          <TokenIcon
            symbol={borrowVault.asset.symbol}
            logoUrl={tokenImageUrl(chainId, borrowVault.asset.address)}
            avatarProps={{ sx: { width: 40, height: 40, fontSize: 12 } }}
          />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h2" sx={{ lineHeight: 1.1 }}>
            {collateralSymbol} → {borrowVault.asset.symbol}
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.grey[500] }} noWrap>
            {t('position.subtitle', 'Manage your {borrow} position against {collateral}', {
              borrow: borrowVault.asset.symbol,
              collateral: collateralSymbol
            })}
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={2.5} alignItems="flex-start">
        {/* Info column */}
        <Grid size={{ xs: 12, md: 7 }} sx={{ order: { xs: 2, md: 1 } }}>
          <Stack spacing={2}>
            <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              <Typography variant="h3" sx={{ marginBottom: 2 }}>
                {t('position.yourPosition', 'Your position')}
              </Typography>
              {position ? (
                <Grid container spacing={2.5}>
                  <Overview label={t('position.collateralValue', 'Collateral value')}>{fmtUsd(position.totalCollateralValueUsd)}</Overview>
                  <Overview label={t('common.debt', 'Debt')}>{fmtUsd(position.liabilityValueUsd)}</Overview>
                  <Overview label={t('common.healthFactor', 'Health factor')}>
                    <Box component="span" sx={{ color: healthColor(hf) }}>
                      {Number.isFinite(hf) && hf > 0 ? hf.toFixed(2) : '∞'}
                    </Box>
                  </Overview>
                  <Overview
                    label={t('common.netApy', 'Net APY')}
                    info={<YieldBreakdownInfo kind="apy" breakdown={position.apyBreakdown} total={position.netApy} />}
                    caption={t('position.onSuppliedCollateral', 'On {value} of supplied collateral', {
                      value: fmtUsd(position.totalCollateralValueUsd)
                    })}
                  >
                    <Box component="span" sx={{ color: position.netApy >= 0 ? theme.palette.success.main : theme.palette.error.main }}>
                      {fmtPct(position.netApy)}
                    </Box>
                  </Overview>
                  <Overview
                    label={t('common.roe', 'ROE')}
                    info={
                      <YieldBreakdownInfo
                        kind="roe"
                        breakdown={position.roeBreakdown}
                        total={positionRoe}
                        leadRows={[
                          {
                            label: t('yield.yourLtv', 'Your LTV'),
                            caption: t('yield.yourLtvCaption', 'Current loan-to-value ratio'),
                            value: `${currentLtv.toFixed(2)}%`
                          },
                          {
                            label: t('yield.multiplier', 'Multiplier'),
                            caption: t('yield.multiplierCaption', 'Effective multiplier at your LTV'),
                            value: positionLeverage
                          }
                        ]}
                      />
                    }
                    caption={t('position.leverageCaption', '{value} leverage on {equity} of equity', {
                      value: positionLeverage,
                      equity: fmtUsd(position.totalCollateralValueUsd - position.liabilityValueUsd)
                    })}
                  >
                    <Box component="span" sx={{ color: positionRoe >= 0 ? theme.palette.success.main : theme.palette.error.main }}>
                      {fmtPct(positionRoe)}
                    </Box>
                  </Overview>
                  <Overview label={t('position.currentLtv', 'Current LTV')}>
                    {currentLtv.toFixed(2)}%{' '}
                    <Typography component="span" variant="body2" sx={{ color: theme.palette.grey[500] }}>
                      {t('position.liqSuffix', '/ liq {value}%', { value: (liquidationLtv * 100).toFixed(0) })}
                    </Typography>
                  </Overview>
                  <Overview label={t('common.liquidationPrice', '{symbol} liquidation price', { symbol: borrowVault.asset.symbol })}>
                    {position.borrowLiquidationPriceUsd > 0
                      ? `$${position.borrowLiquidationPriceUsd.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
                      : '—'}
                  </Overview>
                </Grid>
              ) : portfolioQuery.isPending ? (
                <Box role="status" aria-live="polite" sx={{ display: 'grid', placeItems: 'center', minHeight: 120 }}>
                  <CircularProgress size={28} aria-label={t('position.loadingPosition', 'Loading your position')} />
                </Box>
              ) : portfolioQuery.isError ? (
                <Alert severity="warning">
                  {t('position.loadFailed', 'Your position could not be loaded. Retry in a moment — market data below is unaffected.')}
                </Alert>
              ) : (
                <Alert severity="info">
                  {t(
                    'position.noOpenPosition',
                    'No open position found for this pair on your account. Use the Borrow tab to open one, or check the selected network.'
                  )}
                </Alert>
              )}
            </Paper>

            <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              <Typography variant="h3" sx={{ marginBottom: 2 }}>
                {t('common.marketParameters', 'Market parameters')}
              </Typography>
              <Stack spacing={1.5}>
                <Row
                  label={t('common.borrowApy', 'Borrow APY')}
                  value={`${(borrowVault.borrowApy ?? 0).toFixed(2)}%`}
                  valueColor={theme.palette.warning.main}
                />
                <Row
                  label={t('common.collateralSupplyApy', '{symbol} supply APY', { symbol: collateralSymbol })}
                  value={`${collateralSupplyApy.toFixed(2)}%`}
                />
                <Row
                  label={t('common.maxLtv', 'Max LTV')}
                  hint={t('common.maxLtvHint', 'Highest loan-to-value you can borrow to against this collateral')}
                  value={`${(borrowLtv * 100).toFixed(2)}%`}
                />
                <Row
                  label={t('common.liquidationLtv', 'Liquidation LTV')}
                  hint={t('common.liquidationLtvHint', 'LTV at which the position becomes eligible for liquidation')}
                  value={`${(liquidationLtv * 100).toFixed(2)}%`}
                />
                <Row label={t('common.availableLiquidity', 'Available liquidity')} value={fmtUsd(availableLiquidityUsd)} />
                <Row label={t('common.utilization', 'Utilization')} value={`${((borrowVault.utilization || 0) * 100).toFixed(2)}%`} />
              </Stack>
            </Paper>

            <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              <Typography variant="h3" sx={{ marginBottom: 2 }}>
                {t('common.addresses', 'Addresses')}
              </Typography>
              <Stack spacing={1.25}>
                <AddressRow label={t('common.collateralVault', 'Collateral vault')} address={collateral} onCopy={copy.copyToClipboard} />
                <AddressRow label={t('common.borrowVault', 'Borrow vault')} address={liability} onCopy={copy.copyToClipboard} />
                {collateralAssetAddress && (
                  <AddressRow label={collateralSymbol} address={collateralAssetAddress} onCopy={copy.copyToClipboard} />
                )}
                <AddressRow label={borrowVault.asset.symbol} address={borrowVault.asset.address} onCopy={copy.copyToClipboard} />
              </Stack>
            </Paper>
          </Stack>
        </Grid>

        {/* Action column */}
        <Grid size={{ xs: 12, md: 5 }} sx={{ order: { xs: 1, md: 2 }, position: { md: 'sticky' }, top: { md: 96 } }}>
          <Paper sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1, overflow: 'hidden' }}>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="fullWidth"
              aria-label={t('position.actionsLabel', 'Position actions')}
              sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}
            >
              <Tab label={t('common.repay', 'Repay')} aria-label={t('position.tab.repay', 'Repay debt')} />
              <Tab label={t('common.borrow', 'Borrow')} aria-label={t('position.tab.borrow', 'Borrow more')} />
              <Tab label={t('position.tab.addShort', 'Add')} aria-label={t('position.addCollateral', 'Add collateral')} />
              <Tab label={t('position.tab.removeShort', 'Remove')} aria-label={t('position.removeCollateral', 'Remove collateral')} />
              {SHOW_REFINANCE && <Tab label={t('position.refinance', 'Refinance')} />}
            </Tabs>

            <Box sx={{ padding: 2.5 }}>
              {!collateralAssetAddress || collateralDecimals === undefined ? (
                <Box role="status" aria-live="polite" sx={{ display: 'grid', placeItems: 'center', minHeight: 180 }}>
                  <CircularProgress aria-label={t('position.loadingCollateral', 'Loading collateral details')} />
                </Box>
              ) : tab === 0 ? (
                <RepayForm
                  chainId={chainId}
                  liabilityVault={{
                    address: liability as Address,
                    asset: {
                      address: borrowVault.asset.address as Address,
                      symbol: borrowVault.asset.symbol,
                      decimals: borrowVault.asset.decimals
                    },
                    borrowApy: borrowVault.borrowApy ?? 0
                  }}
                  assetPriceUsd={borrowPrice}
                  tokenLogoUrl={tokenImageUrl(chainId, borrowVault.asset.address)}
                  onSuccess={refetchAll}
                />
              ) : tab === 1 ? (
                <BorrowForm
                  chainId={chainId}
                  collateralVault={collateral as Address}
                  collateralAsset={{ address: collateralAssetAddress as Address, symbol: collateralSymbol, decimals: collateralDecimals }}
                  collateralLogoUrl={tokenImageUrl(chainId, collateralAssetAddress)}
                  collateralPriceUsd={collateralPrice}
                  liabilityVault={borrowVault}
                  borrowLogoUrl={tokenImageUrl(chainId, borrowVault.asset.address)}
                  borrowPriceUsd={borrowPrice}
                  borrowLtv={borrowLtv}
                  liquidationLtv={liquidationLtv}
                  borrowOnly={Boolean(position)}
                  existingCollateralUsd={position?.totalCollateralValueUsd}
                  existingDebtUsd={position?.liabilityValueUsd}
                  onSuccess={refetchAll}
                />
              ) : tab === 2 ? (
                <VaultActionForm
                  mode="supply"
                  chainId={chainId}
                  vaultAddress={collateral as Address}
                  asset={{ address: collateralAssetAddress as Address, symbol: collateralSymbol, decimals: collateralDecimals }}
                  supplyApy={collateralSupplyApy}
                  assetPriceUsd={collateralPrice}
                  tokenLogoUrl={tokenImageUrl(chainId, collateralAssetAddress)}
                  supplyLabel={t('position.addCollateral', 'Add collateral')}
                  onSuccess={refetchAll}
                />
              ) : (
                <VaultActionForm
                  mode="withdraw"
                  chainId={chainId}
                  vaultAddress={collateral as Address}
                  asset={{ address: collateralAssetAddress as Address, symbol: collateralSymbol, decimals: collateralDecimals }}
                  assetPriceUsd={collateralPrice}
                  tokenLogoUrl={tokenImageUrl(chainId, collateralAssetAddress)}
                  withdrawLabel={t('position.removeCollateral', 'Remove collateral')}
                  onSuccess={refetchAll}
                />
              )}
              {tab === 3 && (
                <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ marginTop: 2 }}>
                  {t(
                    'position.removeCollateralNotice',
                    'Removing collateral is blocked by the vault if it would push your position past its liquidation LTV — the wallet simulation will revert before you sign.'
                  )}
                </Alert>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

function Overview({
  label,
  children,
  info,
  caption
}: {
  label: string;
  children: React.ReactNode;
  info?: React.ReactNode;
  caption?: string;
}) {
  return (
    <Grid size={{ xs: 6 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography color="text.secondary" variant="body2">
          {label}
        </Typography>
        {info}
      </Box>
      <Typography variant="h4" component="div" sx={{ marginTop: 0.25 }}>
        {children}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      )}
    </Grid>
  );
}

function Row({ label, value, hint, valueColor }: { label: string; value: string; hint?: string; valueColor?: string }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography color="text.secondary">{label}</Typography>
        {hint && (
          <Tooltip title={hint} arrow>
            <InfoOutlinedIcon sx={{ fontSize: 14, color: theme.palette.grey[600] }} />
          </Tooltip>
        )}
      </Box>
      <Typography sx={{ textAlign: 'right', color: valueColor }}>{value}</Typography>
    </Box>
  );
}

function AddressRow({ label, address, onCopy }: { label: string; address: string; onCopy: (text: string) => void }) {
  const t = useTranslate();

  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography>{shortAddress(address)}</Typography>
        <IconButton
          size="small"
          onClick={() => onCopy(address)}
          aria-label={t('common.copyLabelAddress', 'Copy {label} address', { label })}
        >
          <ContentCopyIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Box>
    </Box>
  );
}
