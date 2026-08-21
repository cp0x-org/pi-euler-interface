import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Avatar,
  AvatarGroup,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import StarOutlineIcon from '@mui/icons-material/StarOutline';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import WalletOutlinedIcon from '@mui/icons-material/WalletOutlined';
import { Address, Hex, decodeFunctionResult, encodeFunctionData } from 'viem';

import {
  entityLogoUrl,
  fetchEntities,
  fetchIntrinsicApys,
  fetchProducts,
  fetchRewardApys,
  fetchVaultsBatch,
  rpcCall,
  tokenImageUrl
} from '@/api/euler';
import { getRuntimeConfig } from '@/appconfig/runtime';
import { ERC20_ABI, ERC4626_ABI } from '@/contracts/erc4626';
import ChainFilter, { ChainFilterValue } from 'components/ChainFilter';
import { ChainBadge } from 'components/ChainIcon';
import { TokenIcon } from 'components/TokenIcon';
import { EulerProduct, EulerVaultRewards, V3VaultDetail } from 'types/euler';
import useTranslate from 'hooks/useTranslate';
import { getChainName } from 'utils/chains';
import { formatShortUSDS } from 'utils/formatters';

type SortMode = 'totalSupply' | 'supplyApy' | 'availableLiquidity' | 'utilization' | 'name';

interface LendExposure {
  address: string;
  symbol: string;
}

interface LendVaultCard {
  chainId: number;
  address: string;
  name: string;
  marketName: string;
  assetAddress: string;
  assetSymbol: string;
  riskManagerName: string;
  riskManagerLogo?: string;
  totalSupplyUsd: number;
  availableLiquidityUsd: number;
  utilization: number;
  supplyApy: number;
  rewardApy: number;
  exposures: LendExposure[];
  recentlyAdded: boolean;
  privateMarket: boolean;
}

interface ProductMembership {
  product: EulerProduct;
  override?: NonNullable<EulerProduct['vaultOverrides']>[string];
  riskManagerSlug?: string;
}

function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${formatShortUSDS(value)}`;
}

function activeRewardApy(rewards: EulerVaultRewards | undefined): number {
  if (!rewards) return 0;
  if (typeof rewards.totalApr === 'number') return rewards.totalApr;
  return rewards.campaigns.filter((campaign) => campaign.status === 'active').reduce((sum, campaign) => sum + campaign.apr, 0);
}

function productEntities(product: EulerProduct): string[] {
  return (Array.isArray(product.entity) ? product.entity : [product.entity]).filter(Boolean);
}

function productVaultOverride(product: EulerProduct, address: string) {
  const target = address.toLowerCase();
  return Object.entries(product.vaultOverrides ?? {}).find(([overrideAddress]) => overrideAddress.toLowerCase() === target)?.[1];
}

async function resolveExposureVaults(chainId: number, vaultAddresses: string[]): Promise<Record<string, LendExposure>> {
  const entries = await Promise.all(
    vaultAddresses.map(async (vaultAddress): Promise<[string, LendExposure] | null> => {
      try {
        const assetResult = await rpcCall<Hex>(chainId, 'eth_call', [
          {
            to: vaultAddress,
            data: encodeFunctionData({ abi: ERC4626_ABI, functionName: 'asset' })
          },
          'latest'
        ]);
        const assetAddress = decodeFunctionResult({
          abi: ERC4626_ABI,
          functionName: 'asset',
          data: assetResult
        }) as Address;
        const symbolResult = await rpcCall<Hex>(chainId, 'eth_call', [
          {
            to: assetAddress,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'symbol' })
          },
          'latest'
        ]);
        const symbol = decodeFunctionResult({ abi: ERC20_ABI, functionName: 'symbol', data: symbolResult }) as string;
        return [vaultAddress.toLowerCase(), { address: assetAddress, symbol }];
      } catch {
        return null;
      }
    })
  );

  return Object.fromEntries(entries.filter((entry): entry is [string, LendExposure] => entry !== null));
}

function UtilizationValue({ value }: { value: number }) {
  const theme = useTheme();
  const percentage = Math.max(0, Math.min(value * 100, 100));
  const color = percentage >= 99.9 ? theme.palette.warning.main : theme.palette.secondary.main;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <CircularProgress aria-hidden="true" variant="determinate" value={percentage} size={22} thickness={5} sx={{ color }} />
      <Typography variant="body1">{percentage.toFixed(2)}%</Typography>
    </Box>
  );
}

// Referenced by the exposure-filter toggle through aria-controls while the extra filter is shown.
const EXPOSURE_FILTER_ID = 'lend-exposure-filter';

export default function LendPage() {
  const theme = useTheme();
  const t = useTranslate();
  const navigate = useNavigate();
  const { chains } = getRuntimeConfig();

  const [search, setSearch] = useState('');
  const [chainFilter, setChainFilter] = useState<ChainFilterValue>('all');
  const [sortMode, setSortMode] = useState<SortMode>('totalSupply');
  const [riskManagerFilter, setRiskManagerFilter] = useState<string[]>([]);
  const [marketFilter, setMarketFilter] = useState<string[]>([]);
  const [assetFilter, setAssetFilter] = useState<string[]>([]);
  const [exposureFilter, setExposureFilter] = useState<string[]>([]);
  const [showExposureFilter, setShowExposureFilter] = useState(false);

  const productsQueries = useQueries({
    queries: chains.map(({ chainId }) => ({
      queryKey: ['euler', 'products', chainId],
      queryFn: () => fetchProducts(chainId)
    }))
  });
  const entitiesQueries = useQueries({
    queries: chains.map(({ chainId }) => ({
      queryKey: ['euler', 'entities', chainId],
      queryFn: () => fetchEntities(chainId)
    }))
  });
  const intrinsicQueries = useQueries({
    queries: chains.map(({ chainId }) => ({
      queryKey: ['euler', 'apys-intrinsic', chainId],
      queryFn: () => fetchIntrinsicApys(chainId)
    }))
  });
  const rewardsQueries = useQueries({
    queries: chains.map(({ chainId }) => ({
      queryKey: ['euler', 'apys-rewards', chainId],
      queryFn: () => fetchRewardApys(chainId)
    }))
  });

  const vaultAddressesByChain = useMemo(
    () =>
      productsQueries.map((productsQuery) => {
        const addresses = new Set<string>();
        for (const product of Object.values(productsQuery.data ?? {})) {
          if (product.notExplorable) continue;
          for (const address of product.vaults ?? []) {
            if (!productVaultOverride(product, address)?.notExplorableLend) addresses.add(address);
          }
        }
        return Array.from(addresses);
      }),
    [productsQueries]
  );

  const vaultsQueries = useQueries({
    queries: chains.map(({ chainId }, index) => {
      const addresses = vaultAddressesByChain[index] ?? [];
      return {
        queryKey: ['euler', 'lend-vaults-batch', chainId, addresses],
        enabled: addresses.length > 0,
        queryFn: () => fetchVaultsBatch(chainId, addresses)
      };
    })
  });

  const unresolvedExposureVaultsByChain = useMemo(
    () =>
      vaultsQueries.map((vaultsQuery) => {
        const addresses = new Set<string>();
        for (const vault of vaultsQuery.data?.data ?? []) {
          for (const collateral of vault.collaterals ?? []) {
            if (!collateral.asset || !collateral.assetSymbol) addresses.add(collateral.collateral);
          }
        }
        return Array.from(addresses);
      }),
    [vaultsQueries]
  );

  const exposureAssetsQueries = useQueries({
    queries: chains.map(({ chainId }, index) => {
      const addresses = unresolvedExposureVaultsByChain[index] ?? [];
      return {
        queryKey: ['euler', 'lend-exposure-assets', chainId, addresses],
        enabled: addresses.length > 0,
        queryFn: () => resolveExposureVaults(chainId, addresses)
      };
    })
  });

  const cards = useMemo<LendVaultCard[]>(() => {
    return chains.flatMap(({ chainId }, index) => {
      const products = productsQueries[index]?.data ?? {};
      const entities = entitiesQueries[index]?.data ?? {};
      const intrinsicData = intrinsicQueries[index]?.data;
      const rewardsData = rewardsQueries[index]?.data;
      const vaultsData = vaultsQueries[index]?.data;
      const exposureAssets = exposureAssetsQueries[index]?.data;
      const memberships = new Map<string, ProductMembership>();
      for (const product of Object.values(products)) {
        if (product.notExplorable) continue;
        const riskManagerSlug = productEntities(product)[0];
        for (const address of product.vaults ?? []) {
          const override = productVaultOverride(product, address);
          if (!override?.notExplorableLend) memberships.set(address.toLowerCase(), { product, override, riskManagerSlug });
        }
      }

      const intrinsicByAsset = new Map((intrinsicData?.data ?? []).map((apy) => [apy.address.toLowerCase(), apy.apy] as const));
      const rewardsByVault = new Map((rewardsData?.data ?? []).map((rewards) => [rewards.vault.toLowerCase(), rewards] as const));
      const vaultsByAddress = new Map((vaultsData?.data ?? []).map((vault) => [vault.address.toLowerCase(), vault] as const));

      return (vaultsData?.data ?? []).flatMap((vault: V3VaultDetail) => {
        const membership = memberships.get(vault.address.toLowerCase());
        if (!membership || !vault.collaterals?.length) return [];

        const { product, override, riskManagerSlug } = membership;
        const riskManager = riskManagerSlug ? entities[riskManagerSlug] : undefined;
        const rewardApy = activeRewardApy(rewardsByVault.get(vault.address.toLowerCase()));
        const exposures = new Map<string, LendExposure>();
        for (const collateral of vault.collaterals) {
          const collateralVault = vaultsByAddress.get(collateral.collateral.toLowerCase());
          const resolvedExposure = exposureAssets?.[collateral.collateral.toLowerCase()];
          const address = collateral.asset || collateralVault?.asset.address || resolvedExposure?.address;
          const symbol = collateral.assetSymbol || collateralVault?.asset.symbol || resolvedExposure?.symbol;
          if (!address || !symbol) continue;
          exposures.set(address.toLowerCase(), { address, symbol });
        }
        const tags = [...(product.tags ?? []), ...(override?.tags ?? [])].map((tag) => tag.toLowerCase());

        return [
          {
            chainId,
            address: vault.address,
            name: override?.name ?? product.name ?? vault.name,
            marketName: product.name ?? vault.name,
            assetAddress: vault.asset.address,
            assetSymbol: vault.asset.symbol,
            riskManagerName: riskManager?.name ?? riskManagerSlug ?? '-',
            riskManagerLogo: entityLogoUrl(riskManager?.logo),
            totalSupplyUsd: vault.totalSupplyUsd || 0,
            availableLiquidityUsd: Math.max((vault.totalSupplyUsd || 0) - (vault.totalBorrowsUsd || 0), 0),
            utilization: vault.utilization || 0,
            supplyApy: (vault.supplyApy || 0) + (intrinsicByAsset.get(vault.asset.address.toLowerCase()) ?? 0) + rewardApy,
            rewardApy,
            exposures: Array.from(exposures.values()),
            recentlyAdded: tags.includes('recently added'),
            privateMarket: tags.includes('private') || tags.includes('keyring') || tags.includes('access control')
          }
        ];
      });
    });
  }, [chains, entitiesQueries, exposureAssetsQueries, intrinsicQueries, productsQueries, rewardsQueries, vaultsQueries]);

  const riskManagerOptions = useMemo(
    () => Array.from(new Set(cards.map((card) => card.riskManagerName).filter((name) => name !== '-'))).sort(),
    [cards]
  );
  const marketOptions = useMemo(() => Array.from(new Set(cards.map((card) => card.marketName))).sort(), [cards]);
  const assetOptions = useMemo(() => Array.from(new Set(cards.map((card) => card.assetSymbol))).sort(), [cards]);
  const exposureOptions = useMemo(
    () => Array.from(new Set(cards.flatMap((card) => card.exposures.map((exposure) => exposure.symbol)))).sort(),
    [cards]
  );
  const chainLabels = useMemo(() => new Map(chains.map((chain) => [chain.chainId, chain.label])), [chains]);

  const visibleCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = cards.filter((card) => {
      if (chainFilter !== 'all' && card.chainId !== chainFilter) return false;
      if (riskManagerFilter.length > 0 && !riskManagerFilter.includes(card.riskManagerName)) return false;
      if (marketFilter.length > 0 && !marketFilter.includes(card.marketName)) return false;
      if (assetFilter.length > 0 && !assetFilter.includes(card.assetSymbol)) return false;
      if (exposureFilter.length > 0 && !card.exposures.some((exposure) => exposureFilter.includes(exposure.symbol))) return false;
      if (!query) return true;
      return [
        card.name,
        card.marketName,
        card.assetSymbol,
        card.riskManagerName,
        chainLabels.get(card.chainId),
        ...card.exposures.map((exposure) => exposure.symbol)
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    const largestMarket = Math.max(...cards.map((card) => card.totalSupplyUsd), 0);
    const promotionThreshold = largestMarket * 0.001;

    return filtered.sort((a, b) => {
      const aPromoted = a.recentlyAdded && a.totalSupplyUsd >= promotionThreshold;
      const bPromoted = b.recentlyAdded && b.totalSupplyUsd >= promotionThreshold;
      if (aPromoted !== bPromoted) return aPromoted ? -1 : 1;

      switch (sortMode) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'supplyApy':
          return b.supplyApy - a.supplyApy;
        case 'availableLiquidity':
          return b.availableLiquidityUsd - a.availableLiquidityUsd;
        case 'utilization':
          return b.utilization - a.utilization;
        case 'totalSupply':
        default:
          return b.totalSupplyUsd - a.totalSupplyUsd;
      }
    });
  }, [assetFilter, cards, chainFilter, chainLabels, exposureFilter, marketFilter, riskManagerFilter, search, sortMode]);

  const failedChains = chains.filter((_, index) =>
    [
      productsQueries[index],
      entitiesQueries[index],
      intrinsicQueries[index],
      rewardsQueries[index],
      vaultsQueries[index],
      exposureAssetsQueries[index]
    ].some((query) => query?.isError)
  );
  const coreLoading = chains.some(
    (_, index) => productsQueries[index]?.isLoading || ((vaultAddressesByChain[index]?.length ?? 0) > 0 && vaultsQueries[index]?.isLoading)
  );
  const loading = cards.length === 0 && coreLoading;
  const fullFailure = cards.length === 0 && !coreLoading && failedChains.length > 0;
  const failedChainLabels = failedChains.map((chain) => chain.label).join(', ');

  return (
    <Box sx={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2.5, marginTop: 1 }}>
        <Avatar
          aria-hidden="true"
          variant="rounded"
          sx={{ width: 56, height: 56, bgcolor: 'transparent', border: `1px solid ${theme.palette.divider}` }}
        >
          <ArrowDownwardIcon sx={{ color: theme.palette.secondary.main, fontSize: 32 }} />
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2" component="h1">
            {t('lend.title', 'Lend')}
          </Typography>
          <Typography variant="body1" sx={{ color: theme.palette.grey[500] }}>
            {t('lend.subtitle', 'Supply assets to isolated lending markets. Earn yield from borrower demand.')}
          </Typography>
        </Box>
      </Box>

      <Grid
        container
        component="search"
        aria-label={t('lend.filtersLabel', 'Filter lending vaults')}
        spacing={1.25}
        sx={{ marginBottom: showExposureFilter ? 1.25 : 2.5 }}
        alignItems="center"
      >
        <Grid size={{ xs: 12, md: 3 }}>
          <TextField
            fullWidth
            size="small"
            type="search"
            placeholder={t('lend.searchPlaceholder', 'Search by asset, market, curator...')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{
              htmlInput: { 'aria-label': t('lend.searchLabel', 'Search lending vaults by asset, market or curator') },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                )
              }
            }}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 1.4 }}>
          <ChainFilter value={chainFilter} onChange={setChainFilter} />
        </Grid>
        <Grid size={{ xs: 6, md: 1.8 }}>
          <Select
            fullWidth
            size="small"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            inputProps={{ 'aria-label': t('lend.sortLabel', 'Sort lending vaults by') }}
            startAdornment={<SwapVertIcon sx={{ fontSize: 18, marginRight: 0.5, color: 'text.secondary' }} />}
          >
            <MenuItem value="totalSupply">{t('common.totalSupply', 'Total supply')}</MenuItem>
            <MenuItem value="supplyApy">{t('common.supplyApy', 'Supply APY')}</MenuItem>
            <MenuItem value="availableLiquidity">{t('common.liquidity', 'Liquidity')}</MenuItem>
            <MenuItem value="utilization">{t('common.utilization', 'Utilization')}</MenuItem>
            <MenuItem value="name">{t('common.name', 'Name')}</MenuItem>
          </Select>
        </Grid>
        <Grid size={{ xs: 6, md: 1.7 }}>
          <Autocomplete
            multiple
            size="small"
            options={riskManagerOptions}
            value={riskManagerFilter}
            onChange={(_, value) => setRiskManagerFilter(value)}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip label={option} {...getTagProps({ index })} size="small" />)
            }
            slotProps={{ popupIndicator: { 'aria-label': t('common.showRiskManagerOptions', 'Show risk manager options') } }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('common.riskManager', 'Risk manager')}
                slotProps={{
                  input: {
                    ...params.InputProps,
                    startAdornment: (
                      <>
                        <ShieldOutlinedIcon sx={{ fontSize: 18, marginRight: 0.5 }} />
                        {params.InputProps.startAdornment}
                      </>
                    )
                  }
                }}
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 1.7 }}>
          <Autocomplete
            multiple
            size="small"
            options={marketOptions}
            value={marketFilter}
            onChange={(_, value) => setMarketFilter(value)}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip label={option} {...getTagProps({ index })} size="small" />)
            }
            slotProps={{ popupIndicator: { 'aria-label': t('lend.showMarketOptions', 'Show market options') } }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('common.market', 'Market')}
                slotProps={{
                  input: {
                    ...params.InputProps,
                    startAdornment: (
                      <>
                        <AccountBalanceOutlinedIcon sx={{ fontSize: 18, marginRight: 0.5 }} />
                        {params.InputProps.startAdornment}
                      </>
                    )
                  }
                }}
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 1.4 }}>
          <Autocomplete
            multiple
            size="small"
            options={assetOptions}
            value={assetFilter}
            onChange={(_, value) => setAssetFilter(value)}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip label={option} {...getTagProps({ index })} size="small" />)
            }
            slotProps={{ popupIndicator: { 'aria-label': t('common.showAssetOptions', 'Show asset options') } }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('common.asset', 'Asset')}
                slotProps={{
                  input: {
                    ...params.InputProps,
                    startAdornment: (
                      <>
                        <WalletOutlinedIcon sx={{ fontSize: 18, marginRight: 0.5 }} />
                        {params.InputProps.startAdornment}
                      </>
                    )
                  }
                }}
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 1 }}>
          <Button
            fullWidth
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setShowExposureFilter((value) => !value)}
            aria-label={t('lend.filterByExposure', 'Filter by current exposure')}
            aria-expanded={showExposureFilter}
            aria-controls={showExposureFilter ? EXPOSURE_FILTER_ID : undefined}
            sx={{ height: 40, whiteSpace: 'nowrap', paddingX: 0.75 }}
          >
            {t('common.filter', 'Filter')}
          </Button>
        </Grid>
      </Grid>

      {showExposureFilter && (
        <Box id={EXPOSURE_FILTER_ID} sx={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2.5 }}>
          <Autocomplete
            multiple
            size="small"
            options={exposureOptions}
            value={exposureFilter}
            onChange={(_, value) => setExposureFilter(value)}
            sx={{ width: { xs: '100%', sm: 320 } }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip label={option} {...getTagProps({ index })} size="small" />)
            }
            slotProps={{ popupIndicator: { 'aria-label': t('common.showExposureOptions', 'Show current exposure options') } }}
            renderInput={(params) => <TextField {...params} label={t('common.currentExposure', 'Current exposure')} />}
          />
        </Box>
      )}

      {cards.length > 0 && failedChains.length > 0 && (
        <Alert severity="warning" variant="outlined" sx={{ marginBottom: 1.25 }}>
          {t('lend.partialFailure', 'Some networks failed to load ({chains}). Showing available lending vaults.', {
            chains: failedChainLabels
          })}
        </Alert>
      )}

      {loading && (
        <Box role="status" aria-live="polite" sx={{ display: 'flex', justifyContent: 'center', padding: 7 }}>
          <CircularProgress aria-label={t('lend.loading', 'Loading lending vaults')} />
        </Box>
      )}

      {fullFailure && (
        <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}` }}>
          <Typography color="error">
            {t('lend.loadFailed', 'Failed to load Euler Lend data for {chains}.', { chains: failedChainLabels })}
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.grey[500], marginTop: 1 }}>
            {t('common.evkDataSourceHint', 'Product labels and EVK metrics come directly from the configured public Euler endpoints.')}
          </Typography>
        </Paper>
      )}

      {!loading && !fullFailure && visibleCards.length === 0 && (
        <Paper role="status" sx={{ padding: 3, border: `1px solid ${theme.palette.divider}` }}>
          <Typography>{t('lend.empty', 'No lending vaults match the current filters.')}</Typography>
        </Paper>
      )}

      {!loading && !fullFailure && (
        <Stack
          component="ul"
          spacing={1.25}
          aria-label={t('lend.listLabel', 'Lending vaults')}
          sx={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {visibleCards.map((vault) => (
            <Box component="li" key={`${vault.chainId}:${vault.address.toLowerCase()}`}>
              <Paper
                aria-label={t('lend.card.open', 'Open lending vault {symbol} in {market} on {network}, supply APY {apy}%', {
                  symbol: vault.assetSymbol,
                  market: vault.marketName,
                  network: getChainName(vault.chainId),
                  apy: vault.supplyApy.toFixed(2)
                })}
                onClick={() => navigate(`/lend/${vault.address}?network=${vault.chainId}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/lend/${vault.address}?network=${vault.chainId}`);
                  }
                }}
                role="link"
                tabIndex={0}
                sx={{
                  padding: 0,
                  overflow: 'hidden',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': { borderColor: theme.palette.secondary.main },
                  '&:focus-visible': { outline: `2px solid ${theme.palette.secondary.main}`, outlineOffset: 2 }
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    padding: 2,
                    borderBottom: `1px solid ${theme.palette.divider}`
                  }}
                >
                  <TokenIcon
                    symbol={vault.assetSymbol}
                    logoUrl={tokenImageUrl(vault.chainId, vault.assetAddress)}
                    avatarProps={{ sx: { width: 40, height: 40, fontSize: 12 } }}
                  />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, marginBottom: 0.25 }}>
                      <Typography variant="body2" sx={{ color: theme.palette.grey[500], overflowWrap: 'anywhere' }}>
                        {vault.name}
                      </Typography>
                      <ChainBadge chainId={vault.chainId} />
                      {vault.recentlyAdded && (
                        <Chip
                          icon={<StarOutlineIcon />}
                          label={t('common.recentlyAdded', 'Recently added')}
                          size="small"
                          color="secondary"
                          variant="outlined"
                          sx={{ height: 22, display: { xs: 'none', sm: 'inline-flex' } }}
                        />
                      )}
                      {vault.privateMarket && (
                        <Chip
                          icon={<LockOutlinedIcon />}
                          label={t('common.private', 'Private')}
                          size="small"
                          variant="outlined"
                          sx={{ height: 22 }}
                        />
                      )}
                    </Box>
                    <Typography variant="h3" component="h2">
                      {vault.assetSymbol}
                    </Typography>
                  </Box>
                  <Box sx={{ flexShrink: 0, textAlign: 'right', marginLeft: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                      {vault.recentlyAdded && (
                        <StarOutlineIcon sx={{ display: { xs: 'block', sm: 'none' }, fontSize: 16, color: 'secondary.main' }} />
                      )}
                      <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                        {t('common.supplyApy', 'Supply APY')}
                      </Typography>
                      <Tooltip title={t('lend.supplyApyHint', 'Base supply APY plus intrinsic yield and active rewards')} arrow>
                        <InfoOutlinedIcon sx={{ fontSize: 14, color: theme.palette.grey[600] }} />
                      </Tooltip>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, marginTop: 0.25 }}>
                      {vault.rewardApy > 0 && <AutoAwesomeIcon sx={{ fontSize: 16, color: theme.palette.secondary.main }} />}
                      <Typography variant="h4" component="p" sx={{ color: theme.palette.secondary.main }}>
                        {vault.supplyApy.toFixed(2)}%
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                <Grid container spacing={2} sx={{ padding: 2 }} alignItems="center">
                  <Grid size={{ xs: 6, md: 2.5 }} sx={{ order: { xs: 3, md: 1 } }}>
                    <Typography variant="body2" sx={{ color: theme.palette.grey[500], marginBottom: 0.5 }}>
                      {t('common.riskManager', 'Risk manager')}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                      <Avatar src={vault.riskManagerLogo} alt="" aria-hidden="true" sx={{ width: 22, height: 22, fontSize: 10 }}>
                        {vault.riskManagerName === '-' ? '-' : vault.riskManagerName.slice(0, 1)}
                      </Avatar>
                      <Typography variant="body1" noWrap>
                        {vault.riskManagerName}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 6, md: 2.2 }} sx={{ order: { xs: 1, md: 2 } }}>
                    <Typography variant="body2" sx={{ color: theme.palette.grey[500], marginBottom: 0.5 }}>
                      {t('common.totalSupply', 'Total supply')}
                    </Typography>
                    <Typography variant="body1">{formatUsd(vault.totalSupplyUsd)}</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, md: 2.3 }} sx={{ order: { xs: 2, md: 3 }, textAlign: { xs: 'right', md: 'left' } }}>
                    <Typography variant="body2" sx={{ color: theme.palette.grey[500], marginBottom: 0.5 }}>
                      {t('common.availableLiquidity', 'Available liquidity')}
                    </Typography>
                    <Typography variant="body1">{formatUsd(vault.availableLiquidityUsd)}</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, md: 2 }} sx={{ order: { xs: 4, md: 4 } }}>
                    <Typography variant="body2" sx={{ color: theme.palette.grey[500], marginBottom: 0.5 }}>
                      {t('common.utilization', 'Utilization')}
                    </Typography>
                    <UtilizationValue value={vault.utilization} />
                  </Grid>
                  <Grid size={{ xs: 12, md: 3 }} sx={{ order: 5, textAlign: { md: 'right' } }}>
                    <Typography variant="body2" sx={{ color: theme.palette.grey[500], marginBottom: 0.5 }}>
                      {t('common.currentExposure', 'Current exposure')}
                    </Typography>
                    {vault.exposures.length > 0 ? (
                      <AvatarGroup
                        max={5}
                        role="group"
                        aria-label={t('common.currentExposureList', 'Current exposure: {assets}', {
                          assets: vault.exposures.map((exposure) => exposure.symbol).join(', ')
                        })}
                        sx={{
                          justifyContent: { xs: 'flex-start', md: 'flex-end' },
                          '& .MuiAvatar-root': { width: 24, height: 24, fontSize: 8, border: `1px solid ${theme.palette.divider}` }
                        }}
                      >
                        {vault.exposures.map((exposure) => (
                          <Tooltip key={`${vault.chainId}:${exposure.address.toLowerCase()}`} title={exposure.symbol} arrow>
                            <Avatar src={tokenImageUrl(vault.chainId, exposure.address)} alt={exposure.symbol}>
                              {exposure.symbol.slice(0, 2)}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </AvatarGroup>
                    ) : (
                      <Typography>-</Typography>
                    )}
                  </Grid>
                </Grid>
              </Paper>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
