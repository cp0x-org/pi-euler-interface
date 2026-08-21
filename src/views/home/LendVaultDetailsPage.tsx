import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
  useTheme
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Address, formatUnits, isAddress } from 'viem';

import { entityLogoUrl, fetchEntities, fetchProducts, fetchVaultsBatch, tokenImageUrl } from '@/api/euler';
import { useNetworkParam } from 'hooks/useNetworkParam';
import { TokenIcon } from 'components/TokenIcon';
import VaultActionForm from 'components/VaultActionForm';
import { useCopyToClipboard } from 'hooks/useCopyToClipboard';
import useTranslate from 'hooks/useTranslate';
import { EulerEntity, EulerProduct } from 'types/euler';
import { formatShortUSDS } from 'utils/formatters';

function formatUsd(value: number): string {
  return value > 0 && value < 0.01 ? '<$0.01' : `$${formatShortUSDS(value)}`;
}
function rawAmount(raw: string, decimals: number): number {
  try {
    return Number(formatUnits(BigInt(raw), decimals));
  } catch {
    return 0;
  }
}
function addressLabel(address?: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '-';
}
function entityForProduct(product: EulerProduct | undefined, entities: Record<string, EulerEntity>): EulerEntity | undefined {
  const slug = product ? (Array.isArray(product.entity) ? product.entity[0] : product.entity) : undefined;
  return slug ? entities[slug] : undefined;
}

export default function LendVaultDetailsPage() {
  const theme = useTheme();
  const t = useTranslate();
  const navigate = useNavigate();
  const { lendAddress = '' } = useParams<{ lendAddress: string }>();
  const [params] = useSearchParams();
  const [actionTab, setActionTab] = useState(params.get('action') === 'withdraw' ? 1 : 0);
  const { chainId } = useNetworkParam();
  const valid = isAddress(lendAddress);
  const copy = useCopyToClipboard();
  const vaultQuery = useQuery({
    queryKey: ['euler', 'lend-vault-detail', chainId, lendAddress],
    enabled: valid,
    queryFn: () => fetchVaultsBatch(chainId, [lendAddress])
  });
  const productsQuery = useQuery({ queryKey: ['euler', 'products', chainId], queryFn: () => fetchProducts(chainId) });
  const entitiesQuery = useQuery({ queryKey: ['euler', 'entities', chainId], queryFn: () => fetchEntities(chainId) });
  const vault = vaultQuery.data?.data?.[0];
  const product = useMemo(
    () =>
      Object.values(productsQuery.data ?? {}).find((item) =>
        (item.vaults ?? []).some((address) => address.toLowerCase() === lendAddress.toLowerCase())
      ),
    [productsQuery.data, lendAddress]
  );
  const riskManager = entityForProduct(product, entitiesQuery.data ?? {});
  const assetAmount = vault ? rawAmount(vault.totalAssets, vault.asset.decimals) : 0;
  const price = vault && assetAmount > 0 ? vault.totalSupplyUsd / assetAmount : 0;
  const liquidity = vault ? Math.max(vault.totalSupplyUsd - vault.totalBorrowsUsd, 0) : 0;

  if (!valid)
    return (
      <Paper sx={{ padding: 3 }}>
        <Typography color="error">{t('lendDetail.invalidAddress', 'Invalid Lend vault address.')}</Typography>
      </Paper>
    );
  if (vaultQuery.isLoading)
    return (
      <Box role="status" aria-live="polite" sx={{ display: 'grid', placeItems: 'center', minHeight: 420 }}>
        <CircularProgress aria-label={t('lendDetail.loading', 'Loading lending market')} />
      </Box>
    );
  if (vaultQuery.error || !vault)
    return (
      <Paper sx={{ padding: 3 }}>
        <Typography color="error">{t('lendDetail.loadFailed', 'Failed to load Lend market.')}</Typography>
        <Button sx={{ marginTop: 2 }} onClick={() => navigate(`/lend?network=${chainId}`)} startIcon={<ArrowBackIcon />}>
          {t('lendDetail.back', 'Back to Lend')}
        </Button>
      </Paper>
    );

  return (
    <Box sx={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, marginBottom: 2.5 }}>
        <IconButton onClick={() => navigate(`/lend?network=${chainId}`)} aria-label={t('lendDetail.back', 'Back to Lend')}>
          <ArrowBackIcon />
        </IconButton>
        <TokenIcon
          symbol={vault.asset.symbol}
          logoUrl={tokenImageUrl(chainId, vault.asset.address)}
          avatarProps={{ sx: { width: 48, height: 48 } }}
        />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography color="text.secondary" noWrap>
            {vault.name}
            <IconButton
              size="small"
              onClick={() => copy.copyToClipboard(vault.address)}
              aria-label={t('common.copyVaultAddress', 'Copy vault address')}
            >
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Typography>
          <Typography variant="h2">{vault.asset.symbol}</Typography>
        </Box>
      </Box>
      <Grid container spacing={2.5} alignItems="flex-start">
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
              <Grid container spacing={3}>
                <Grid size={{ xs: 6 }}>
                  <Typography color="text.secondary">{t('common.price', 'Price')}</Typography>
                  <Typography variant="h4">${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography color="text.secondary">{t('common.vaultType', 'Vault type')}</Typography>
                  <Chip icon={<OpenInNewIcon />} label={t('lendDetail.governed', 'Governed')} variant="outlined" size="small" />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography color="text.secondary">{t('common.market', 'Market')}</Typography>
                  <Typography variant="h4">{product?.name ?? vault.name}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography color="text.secondary">{t('common.riskManager', 'Risk manager')}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box component="img" src={entityLogoUrl(riskManager?.logo)} alt="" aria-hidden="true" sx={{ width: 24, height: 24 }} />
                    <Typography variant="h4">{riskManager?.name ?? '-'}</Typography>
                  </Box>
                </Grid>
              </Grid>
              <Typography color="text.secondary" sx={{ marginTop: 2 }}>
                {t('lendDetail.canBeBorrowed', 'Can be borrowed')}
              </Typography>
              <Typography>
                {(vault.collaterals?.length ?? 0) > 0
                  ? t('lendDetail.yesInMarkets', 'Yes in {count} markets', { count: vault.collaterals?.length ?? 0 })
                  : t('lendDetail.noCollateralMarkets', 'No collateral markets')}
              </Typography>
            </Paper>
            <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              <Typography variant="h3" sx={{ marginBottom: 2 }}>
                {t('common.statistics', 'Statistics')}
              </Typography>
              <Stack spacing={2}>
                <Stat label={t('common.totalSupply', 'Total supply')} value={formatUsd(vault.totalSupplyUsd)} />
                <Stat label={t('common.totalBorrowed', 'Total borrowed')} value={formatUsd(vault.totalBorrowsUsd)} />
                <Stat label={t('common.pendingBadDebt', 'Pending bad debt')} value="$0" />
                <Stat label={t('common.availableLiquidity', 'Available liquidity')} value={formatUsd(liquidity)} />
                <Stat label={t('common.supplyApy', 'Supply APY')} value={`${vault.supplyApy.toFixed(2)}%`} />
                <Stat label={t('common.borrowApy', 'Borrow APY')} value={`${vault.borrowApy.toFixed(2)}%`} />
                <Stat label={t('common.utilization', 'Utilization')} value={`${(vault.utilization * 100).toFixed(2)}%`} />
              </Stack>
            </Paper>
            <Accordion
              defaultExpanded
              sx={{ border: '1px solid', borderColor: 'divider', boxShadow: 'none', '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="h3">{t('lendDetail.collateralMarkets', 'Collateral markets')}</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  {(vault.collaterals ?? []).map((collateral) => (
                    <Box
                      key={collateral.collateral}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 2,
                        borderTop: `1px solid ${theme.palette.divider}`,
                        paddingTop: 1.5
                      }}
                    >
                      <Typography>{collateral.collateralName || collateral.collateralSymbol}</Typography>
                      <Typography color="text.secondary">
                        {t('lendDetail.ltvSummary', 'Borrow LTV {borrow}% · Liquidation {liquidation}%', {
                          borrow: (Number(collateral.borrowLTV) / 100).toFixed(2),
                          liquidation: (Number(collateral.liquidationLTV) / 100).toFixed(2)
                        })}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
            <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              <Typography variant="h3" sx={{ marginBottom: 2 }}>
                {t('common.addresses', 'Addresses')}
              </Typography>
              <Stat label={t('common.vault', 'Vault')} value={addressLabel(vault.address)} />
              <Stat label={vault.asset.symbol} value={addressLabel(vault.asset.address)} />
            </Paper>
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }} sx={{ order: { xs: 1, md: 2 }, position: { md: 'sticky' }, top: { md: 96 } }}>
          <Paper sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1, overflow: 'hidden' }}>
            <Tabs
              value={actionTab}
              onChange={(_, value) => setActionTab(value)}
              variant="fullWidth"
              aria-label={t('lendDetail.actionsLabel', 'Lending vault actions')}
              sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}
            >
              <Tab label={t('common.supply', 'Supply')} />
              <Tab label={t('common.withdraw', 'Withdraw')} />
            </Tabs>
            <Box sx={{ padding: 2.5 }}>
              <VaultActionForm
                mode={actionTab === 0 ? 'supply' : 'withdraw'}
                chainId={chainId}
                vaultAddress={vault.address as Address}
                asset={{ address: vault.asset.address as Address, symbol: vault.asset.symbol, decimals: vault.asset.decimals }}
                supplyApy={vault.supplyApy}
                assetPriceUsd={price}
                tokenLogoUrl={tokenImageUrl(chainId, vault.asset.address)}
                onSuccess={() => void vaultQuery.refetch()}
              />
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ textAlign: 'right' }}>{value}</Typography>
    </Box>
  );
}
