import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  InputBase,
  LinearProgress,
  Paper,
  Slider,
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
import { Address, Hex, decodeFunctionResult, encodeFunctionData, isAddress } from 'viem';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

import {
  entityLogoUrl,
  fetchEntities,
  fetchIntrinsicApys,
  fetchPrices,
  fetchProducts,
  fetchVaultsBatch,
  rpcCall,
  tokenImageUrl
} from '@/api/euler';
import { useNetworkParam } from 'hooks/useNetworkParam';
import { ERC20_ABI, ERC4626_ABI } from '@/contracts/erc4626';
import BorrowForm from 'components/BorrowForm';
import { TokenIcon } from 'components/TokenIcon';
import { useCopyToClipboard } from 'hooks/useCopyToClipboard';
import useTranslate from 'hooks/useTranslate';
import { EulerEntity, EulerProduct, V3Collateral } from 'types/euler';
import { formatShortUSDS } from 'utils/formatters';

// Multiply is hidden from the form for now (swap-routed execution not wired yet). The tab and its
// preview stay in the code below — flip this to re-enable them once leverage execution lands.
const SHOW_MULTIPLY: boolean = false;

function sanitizeAmount(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.');
  return parts.length <= 1 ? cleaned : `${parts[0]}.${parts.slice(1).join('')}`;
}

function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '-';
}

function entityForProduct(product: EulerProduct | undefined, entities: Record<string, EulerEntity>): EulerEntity | undefined {
  const slug = product ? (Array.isArray(product.entity) ? product.entity[0] : product.entity) : undefined;
  return slug ? entities[slug] : undefined;
}

function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${formatShortUSDS(value)}`;
}

// Escrow collateral vaults expose no metrics in the batch payload; read the underlying
// asset()/symbol()/decimals() straight from the chain so the pair renders (and can transact) the
// real token.
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

export default function BorrowDetailPage() {
  const theme = useTheme();
  const t = useTranslate();
  const navigate = useNavigate();
  const copy = useCopyToClipboard();
  const { address: account } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { collateral = '', liability = '' } = useParams<{ collateral: string; liability: string }>();
  const [params] = useSearchParams();
  const { chainId } = useNetworkParam();
  const tabParam = params.get('tab') === 'multiply' ? 1 : 0;
  const [tab, setTab] = useState(tabParam);
  const activeTab = SHOW_MULTIPLY ? tab : 0;

  const valid = isAddress(collateral) && isAddress(liability);

  const vaultsQuery = useQuery({
    queryKey: ['euler', 'borrow-detail', chainId, collateral, liability],
    enabled: valid,
    queryFn: () => fetchVaultsBatch(chainId, [collateral, liability])
  });
  const productsQuery = useQuery({ queryKey: ['euler', 'products', chainId], queryFn: () => fetchProducts(chainId) });
  const entitiesQuery = useQuery({ queryKey: ['euler', 'entities', chainId], queryFn: () => fetchEntities(chainId) });
  const intrinsicQuery = useQuery({ queryKey: ['euler', 'apys-intrinsic', chainId], queryFn: () => fetchIntrinsicApys(chainId) });

  const borrowVault = vaultsQuery.data?.data?.find((vault) => vault.address.toLowerCase() === liability.toLowerCase());
  const collateralVault = vaultsQuery.data?.data?.find((vault) => vault.address.toLowerCase() === collateral.toLowerCase());
  const collateralConfig: V3Collateral | undefined = borrowVault?.collaterals?.find(
    (item) => item.collateral.toLowerCase() === collateral.toLowerCase()
  );

  const hasCollateralAsset = Boolean(collateralConfig?.asset && collateralConfig?.assetSymbol) || Boolean(collateralVault);
  const resolvedCollateralQuery = useQuery({
    queryKey: ['euler', 'borrow-detail-collateral-asset', chainId, collateral],
    enabled: valid && Boolean(borrowVault) && !hasCollateralAsset,
    queryFn: () => resolveCollateralAsset(chainId, collateral)
  });

  const collateralAssetAddress = collateralConfig?.asset || collateralVault?.asset.address || resolvedCollateralQuery.data?.address;
  const collateralSymbol =
    collateralConfig?.assetSymbol ||
    collateralVault?.asset.symbol ||
    resolvedCollateralQuery.data?.symbol ||
    t('common.collateral', 'Collateral');
  const collateralDecimals = collateralConfig?.assetDecimals || collateralVault?.asset.decimals || resolvedCollateralQuery.data?.decimals;

  const pricesQuery = useQuery({
    queryKey: ['euler', 'borrow-detail-prices', chainId, collateralAssetAddress, borrowVault?.asset.address],
    enabled: Boolean(collateralAssetAddress && borrowVault),
    queryFn: () => fetchPrices(chainId, [collateralAssetAddress as string, borrowVault!.asset.address])
  });

  const product = useMemo(
    () =>
      Object.values(productsQuery.data ?? {}).find((item) =>
        (item.vaults ?? []).some((vaultAddress) => vaultAddress.toLowerCase() === liability.toLowerCase())
      ),
    [productsQuery.data, liability]
  );
  const riskManager = entityForProduct(product, entitiesQuery.data ?? {});

  const priceByAddress = useMemo(() => {
    const map = new Map<string, number>();
    for (const price of pricesQuery.data?.data ?? []) map.set(price.address.toLowerCase(), price.priceUsd);
    return map;
  }, [pricesQuery.data]);
  const collateralPrice = collateralAssetAddress ? (priceByAddress.get(collateralAssetAddress.toLowerCase()) ?? 0) : 0;
  const borrowPrice = borrowVault ? (priceByAddress.get(borrowVault.asset.address.toLowerCase()) ?? 0) : 0;

  const borrowLtv = collateralConfig ? Number(collateralConfig.borrowLTV) / 10_000 : 0;
  const liquidationLtv = collateralConfig ? Number(collateralConfig.liquidationLTV) / 10_000 : 0;
  const maxMultiplier = borrowLtv > 0 && borrowLtv < 1 ? 1 / (1 - borrowLtv) : 1;
  const borrowApy = borrowVault?.borrowApy ?? 0;
  const intrinsicByAsset = useMemo(
    () => new Map((intrinsicQuery.data?.data ?? []).map((apy) => [apy.address.toLowerCase(), apy.apy] as const)),
    [intrinsicQuery.data]
  );
  const collateralSupplyApy =
    (collateralVault?.supplyApy ?? 0) + (collateralAssetAddress ? (intrinsicByAsset.get(collateralAssetAddress.toLowerCase()) ?? 0) : 0);
  const availableLiquidityUsd = borrowVault ? Math.max((borrowVault.totalSupplyUsd || 0) - (borrowVault.totalBorrowsUsd || 0), 0) : 0;

  // Multiply-tab preview state (the Borrow tab is handled by <BorrowForm/>).
  const [multiplyCollateral, setMultiplyCollateral] = useState('');
  const [leverage, setLeverage] = useState(1.5);
  const baseUsd = (Number(multiplyCollateral) || 0) * collateralPrice;
  const exposureUsd = baseUsd * leverage;
  const multiplyDebtUsd = baseUsd * (leverage - 1);
  const multiplyLtv = leverage > 0 ? (leverage - 1) / leverage : 0;
  const roe = leverage * collateralSupplyApy - (leverage - 1) * borrowApy;
  const multiplyHealth = multiplyLtv > 0 ? liquidationLtv / multiplyLtv : Infinity;
  const liqDrop = multiplyLtv > 0 && liquidationLtv > 0 ? Math.max(0, 1 - multiplyLtv / liquidationLtv) : 1;

  if (!valid)
    return (
      <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}` }}>
        <Typography color="error">{t('borrowDetail.invalidPair', 'Invalid borrow market address pair.')}</Typography>
        <Button sx={{ marginTop: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate(`/borrow?network=${chainId}`)}>
          {t('borrowDetail.back', 'Back to Borrow')}
        </Button>
      </Paper>
    );
  if (vaultsQuery.isLoading)
    return (
      <Box role="status" aria-live="polite" sx={{ display: 'grid', placeItems: 'center', minHeight: 420 }}>
        <CircularProgress aria-label={t('borrowDetail.loading', 'Loading borrow market')} />
      </Box>
    );
  if (vaultsQuery.error || !borrowVault || !collateralConfig)
    return (
      <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}` }}>
        <Typography color="error">
          {t('borrowDetail.collateralNotAccepted', 'This collateral is not accepted by the selected borrow market.')}
        </Typography>
        <Button sx={{ marginTop: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate(`/borrow?network=${chainId}`)}>
          {t('borrowDetail.back', 'Back to Borrow')}
        </Button>
      </Paper>
    );

  const healthColor = (hf: number) =>
    hf >= 2 ? theme.palette.success.main : hf >= 1.25 ? theme.palette.warning.main : theme.palette.error.main;

  return (
    <Box sx={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, marginBottom: 2.5 }}>
        <IconButton onClick={() => navigate(`/borrow?network=${chainId}`)} aria-label={t('borrowDetail.back', 'Back to Borrow')}>
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
            {t('borrowDetail.subtitle', '{market} · Borrow {borrow} against {collateral}', {
              market: product?.name ?? borrowVault.name,
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
                {t('common.overview', 'Overview')}
              </Typography>
              {product?.description && (
                <Typography color="text.secondary" sx={{ marginBottom: 2 }}>
                  {product.description.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')}
                </Typography>
              )}
              <Grid container spacing={2.5}>
                <Overview label={t('common.market', 'Market')}>{product?.name ?? borrowVault.name}</Overview>
                <Overview label={t('common.riskManager', 'Risk manager')}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box
                      component="img"
                      src={entityLogoUrl(riskManager?.logo)}
                      alt=""
                      aria-hidden="true"
                      sx={{ width: 22, height: 22, borderRadius: '50%' }}
                    />
                    <Typography variant="h4">{riskManager?.name ?? '-'}</Typography>
                  </Box>
                </Overview>
                <Overview label={t('common.collateral', 'Collateral')}>
                  {collateralSymbol}
                  {collateralPrice > 0 && (
                    <Typography component="span" variant="body2" sx={{ color: theme.palette.grey[500], ml: 0.75 }}>
                      ${collateralPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </Typography>
                  )}
                </Overview>
                <Overview label={t('common.borrow', 'Borrow')}>
                  {borrowVault.asset.symbol}
                  {borrowPrice > 0 && (
                    <Typography component="span" variant="body2" sx={{ color: theme.palette.grey[500], ml: 0.75 }}>
                      ${borrowPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </Typography>
                  )}
                </Overview>
              </Grid>
            </Paper>

            <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              <Typography variant="h3" sx={{ marginBottom: 2 }}>
                {t('common.marketParameters', 'Market parameters')}
              </Typography>
              <Stack spacing={1.5}>
                <Row
                  label={t('common.borrowApy', 'Borrow APY')}
                  value={`${borrowApy.toFixed(2)}%`}
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
                <Row
                  label={t('common.maxMultiplier', 'Max multiplier')}
                  hint={t('borrowDetail.maxMultiplierHint', 'Maximum leverage = 1 / (1 − Max LTV)')}
                  value={Number.isFinite(maxMultiplier) ? `${maxMultiplier.toFixed(2)}×` : '—'}
                />
                <Row label={t('common.totalBorrowed', 'Total borrowed')} value={fmtUsd(borrowVault.totalBorrowsUsd || 0)} />
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
              value={activeTab}
              onChange={(_, value) => setTab(value)}
              variant="fullWidth"
              aria-label={t('borrowDetail.actionsLabel', 'Borrow market actions')}
              sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}
            >
              <Tab label={t('common.borrow', 'Borrow')} />
              {SHOW_MULTIPLY && <Tab label={t('borrowDetail.multiply', 'Multiply')} />}
            </Tabs>

            <Box sx={{ padding: 2.5 }}>
              {activeTab === 0 ? (
                collateralAssetAddress && collateralDecimals ? (
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
                    onSuccess={() => void vaultsQuery.refetch()}
                  />
                ) : (
                  <Box role="status" aria-live="polite" sx={{ display: 'grid', placeItems: 'center', minHeight: 180 }}>
                    <CircularProgress aria-label={t('borrowDetail.loadingCollateral', 'Loading collateral details')} />
                  </Box>
                )
              ) : (
                <Stack spacing={2}>
                  <AmountField
                    label={t('borrowDetail.yourCollateral', 'Your collateral')}
                    symbol={collateralSymbol}
                    logoUrl={collateralAssetAddress ? tokenImageUrl(chainId, collateralAssetAddress) : ''}
                    value={multiplyCollateral}
                    onChange={setMultiplyCollateral}
                    usd={baseUsd}
                  />
                  <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('borrowDetail.multiplier', 'Multiplier')}
                      </Typography>
                      <Typography variant="h4" sx={{ color: theme.palette.secondary.main }}>
                        {leverage.toFixed(2)}×
                      </Typography>
                    </Box>
                    <Slider
                      value={leverage}
                      min={1}
                      max={Math.max(1.1, Number(maxMultiplier.toFixed(2)))}
                      step={0.05}
                      onChange={(_, value) => setLeverage(value as number)}
                      aria-label={t('borrowDetail.multiplierSlider', 'Leverage multiplier')}
                      color="secondary"
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="caption" color="text.secondary">
                        1×
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('borrowDetail.maxMultiplierValue', 'Max {value}×', {
                          value: Number.isFinite(maxMultiplier) ? maxMultiplier.toFixed(2) : '—'
                        })}
                      </Typography>
                    </Box>
                  </Box>
                  <PreviewBox>
                    <Row
                      label={t('borrowDetail.exposure', '{symbol} exposure', { symbol: collateralSymbol })}
                      value={fmtUsd(exposureUsd)}
                    />
                    <Row
                      label={t('borrowDetail.debtOf', '{symbol} debt', { symbol: borrowVault.asset.symbol })}
                      value={fmtUsd(multiplyDebtUsd)}
                    />
                    <Row
                      label={t('borrowDetail.estRoe', 'Est. ROE')}
                      hint={t('borrowDetail.estRoeHint', 'Leveraged return on equity = m·collateral APY − (m−1)·borrow APY')}
                      value={`${roe.toFixed(2)}%`}
                      valueColor={roe >= 0 ? theme.palette.success.main : theme.palette.error.main}
                    />
                    <Row label={t('common.loanToValue', 'Loan-to-value')} value={`${(multiplyLtv * 100).toFixed(2)}%`} />
                    <Row
                      label={t('common.healthFactor', 'Health factor')}
                      value={Number.isFinite(multiplyHealth) ? multiplyHealth.toFixed(2) : '∞'}
                      valueColor={healthColor(multiplyHealth)}
                    />
                    <Row
                      label={t('borrowDetail.liquidationBuffer', 'Liquidation buffer')}
                      value={`-${(liqDrop * 100).toFixed(1)}% ${collateralSymbol}`}
                    />
                  </PreviewBox>
                  <ActionButton
                    account={account}
                    label={t('borrowDetail.openMultiply', 'Open multiply position')}
                    connectLabel={t('wallet.connectShort', 'Connect wallet')}
                    pendingLabel={t('borrowDetail.executionPending', 'Execution wiring in progress')}
                    onConnect={openConnectModal}
                  />
                </Stack>
              )}

              {activeTab === 1 && (
                <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ marginTop: 2 }}>
                  {t(
                    'borrowDetail.multiplyNotice',
                    'Live preview. Swap-routed leverage execution (via the Euler swap service) is being wired next — the Borrow tab already opens positions on-chain.'
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

function Overview({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Grid size={{ xs: 6 }}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography variant="h4" component="div" sx={{ marginTop: 0.25 }}>
        {children}
      </Typography>
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

function PreviewBox({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1, padding: 2 }}>
      <Stack spacing={1.25}>{children}</Stack>
    </Box>
  );
}

function AmountField({
  label,
  symbol,
  logoUrl,
  value,
  onChange,
  usd,
  helper
}: {
  label: string;
  symbol: string;
  logoUrl: string;
  value: string;
  onChange: (value: string) => void;
  usd: number;
  helper?: string;
}) {
  const theme = useTheme();
  const t = useTranslate();
  return (
    <Paper variant="outlined" sx={{ padding: 2, borderRadius: 1, borderColor: theme.palette.divider }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {helper && (
          <Typography variant="body2" color="text.secondary">
            {helper}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginY: 0.5 }}>
        <InputBase
          fullWidth
          value={value}
          onChange={(event) => onChange(sanitizeAmount(event.target.value))}
          placeholder="0.00"
          inputProps={{ inputMode: 'decimal', 'aria-label': t('form.fieldAmountLabel', '{label} amount in {symbol}', { label, symbol }) }}
          sx={{ '& input': { fontSize: 28, fontWeight: 500, padding: 0 } }}
        />
        <TokenIcon symbol={symbol} logoUrl={logoUrl} avatarProps={{ sx: { width: 24, height: 24, fontSize: 9 } }} />
        <Typography variant="h4">{symbol}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        ${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
      </Typography>
    </Paper>
  );
}

function ActionButton({
  account,
  label,
  connectLabel,
  pendingLabel,
  onConnect,
  disabled
}: {
  account?: string;
  label: string;
  connectLabel: string;
  pendingLabel: string;
  onConnect?: () => void;
  disabled?: boolean;
}) {
  if (!account)
    return (
      <Button variant="contained" color="secondary" size="large" onClick={() => onConnect?.()} sx={{ minHeight: 48, fontWeight: 600 }}>
        {connectLabel}
      </Button>
    );
  return (
    <Box>
      <Button variant="contained" color="secondary" size="large" fullWidth disabled sx={{ minHeight: 48, fontWeight: 600 }}>
        {label}
      </Button>
      <LinearProgress sx={{ marginTop: 1, borderRadius: 1, opacity: 0.35 }} />
      <Chip label={pendingLabel} size="small" variant="outlined" sx={{ marginTop: 1 }} />
    </Box>
  );
}
