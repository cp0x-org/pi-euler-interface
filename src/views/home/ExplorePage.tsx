import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import {
  Alert,
  Autocomplete,
  Avatar,
  AvatarGroup,
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
import SearchIcon from '@mui/icons-material/Search';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { entityLogoUrl, fetchEntities, fetchProducts, fetchVaultsBatch, fetchIntrinsicApys, tokenImageUrl } from '@/api/euler';
import ChainFilter, { ChainFilterValue } from 'components/ChainFilter';
import { ChainBadge } from 'components/ChainIcon';
import ExploreMarketExperience, { type ExploreResolvedSummary } from 'features/explore/ExploreMarketExperience';
import { V3VaultDetail } from 'types/euler';
import { formatShortUSDS } from 'utils/formatters';
import { getRuntimeConfig } from '@/appconfig/runtime';

type SortMode = 'active' | 'name' | 'totalSupply' | 'totalBorrowed' | 'maxRoe';

interface ProductCard {
  chainId: number;
  chainName: string;
  chainLabel: string;
  slug: string;
  name: string;
  description: string;
  entityNames: string[];
  entityLogo?: string;
  totalSupplyUsd: number;
  totalBorrowedUsd: number;
  availableLiquidityUsd: number;
  assetCount: number;
  pairCount: number;
  unknownVaults: number;
  maxRoe: number | null;
  maxRoePair: string | null;
  assets: { address: string; symbol: string }[];
  memberAddresses: string[];
  vaults: V3VaultDetail[];
}

const expansionId = (chainId: number, slug: string) => `${chainId}:${slug}`;

/** Card targeted by a copied market link: /explore?market=<slug>&network=<chainId>. */
function deepLinkTarget(params: URLSearchParams): string | null {
  const market = params.get('market');
  const network = Number(params.get('network'));
  return market && Number.isInteger(network) && network > 0 ? expansionId(network, market) : null;
}

export default function ExplorePage() {
  const theme = useTheme();
  const { chains } = getRuntimeConfig();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('active');
  const [chainFilter, setChainFilter] = useState<ChainFilterValue>('all');
  const [entityFilter, setEntityFilter] = useState<string[]>([]);
  const [assetFilter, setAssetFilter] = useState<string[]>([]);
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(() => {
    const target = deepLinkTarget(searchParams);
    return target ? new Set([target]) : new Set();
  });
  const [resolvedSummaries, setResolvedSummaries] = useState<Record<string, ExploreResolvedSummary>>({});
  // Scroll a deep-linked card into view once, when its data first renders.
  const pendingScrollId = useRef<string | null>(deepLinkTarget(searchParams));

  const toggleExpanded = (chainId: number, slug: string) => {
    const id = expansionId(chainId, slug);
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    // Drop the resolved snapshot on collapse so a collapsed card tracks live
    // query data instead of numbers frozen at expansion time.
    setResolvedSummaries((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };
  const updateResolvedSummary = useCallback((id: string, summary: ExploreResolvedSummary) => {
    setResolvedSummaries((previous) => {
      const current = previous[id];
      if (
        current &&
        Object.keys(summary).every((key) => current[key as keyof ExploreResolvedSummary] === summary[key as keyof ExploreResolvedSummary])
      ) {
        return previous;
      }
      return { ...previous, [id]: summary };
    });
  }, []);

  const productsQueries = useQueries({
    queries: chains.map((chain) => ({
      queryKey: ['euler', 'products', chain.chainId],
      queryFn: () => fetchProducts(chain.chainId)
    }))
  });
  const entitiesQueries = useQueries({
    queries: chains.map((chain) => ({
      queryKey: ['euler', 'entities', chain.chainId],
      queryFn: () => fetchEntities(chain.chainId)
    }))
  });
  const intrinsicQueries = useQueries({
    queries: chains.map((chain) => ({
      queryKey: ['euler', 'apys-intrinsic', chain.chainId],
      queryFn: () => fetchIntrinsicApys(chain.chainId)
    }))
  });

  // Each chain's public v3 batch request depends on that chain's product labels.
  const vaultAddressesByChain = useMemo(
    () =>
      chains.map((_, index) => {
        const products = productsQueries[index]?.data;
        if (!products) return [] as string[];
        return Array.from(new Set(Object.values(products).flatMap((product) => product.vaults ?? [])));
      }),
    [chains, productsQueries]
  );

  const vaultsQueries = useQueries({
    queries: chains.map((chain, index) => {
      const addresses = vaultAddressesByChain[index] ?? [];
      return {
        queryKey: ['euler', 'vaults-batch', chain.chainId, addresses],
        enabled: addresses.length > 0,
        queryFn: () => fetchVaultsBatch(chain.chainId, addresses)
      };
    })
  });

  const cards: ProductCard[] = useMemo(() => {
    return chains.flatMap((chain, index) => {
      const products = productsQueries[index]?.data;
      const vaultsQuery = vaultsQueries[index];
      const addresses = vaultAddressesByChain[index] ?? [];

      // Keep incomplete chains out of the list while their required vault data is loading.
      // Failed ancillary requests still allow the product labels and available data to render.
      if (!products || (addresses.length > 0 && vaultsQuery?.isPending)) return [];

      const entities = entitiesQueries[index]?.data ?? {};
      const vaultMap = new Map<string, V3VaultDetail>();
      for (const vault of vaultsQuery?.data?.data ?? []) {
        if (vault?.address) vaultMap.set(vault.address.toLowerCase(), vault);
      }

      const intrinsicByAsset = new Map<string, number>();
      for (const intrinsic of intrinsicQueries[index]?.data?.data ?? []) {
        intrinsicByAsset.set(intrinsic.address.toLowerCase(), intrinsic.apy);
      }

      return Object.entries(products).map(([slug, product]) => {
        const entitySlugs = (Array.isArray(product.entity) ? product.entity : [product.entity]).filter(Boolean) as string[];
        const productSet = new Set(product.vaults.map((address) => address.toLowerCase()));
        const vaults = product.vaults.map((address) => vaultMap.get(address.toLowerCase())).filter(Boolean) as V3VaultDetail[];
        const unknownVaults = product.vaults.length - vaults.length;

        let totalSupplyUsd = 0;
        let totalBorrowedUsd = 0;
        let availableLiquidityUsd = 0;
        const assets = new Map<string, string>();
        let pairCount = 0;
        let maxRoe: number | null = null;
        let maxRoePair: string | null = null;

        for (const vault of vaults) {
          totalSupplyUsd += vault.totalSupplyUsd || 0;
          totalBorrowedUsd += vault.totalBorrowsUsd || 0;
          availableLiquidityUsd += Math.max((vault.totalSupplyUsd || 0) - (vault.totalBorrowsUsd || 0), 0);
          assets.set(vault.asset.address.toLowerCase(), vault.asset.symbol);

          // Pairs: (collateral vault, debt vault) combos inside the product.
          // Max ROE approximates a max-leverage loop at the pair's borrow LTV:
          // lev = 1/(1-ltv); roe = lev*supplyAPY(coll) - (lev-1)*borrowAPY(debt).
          for (const collateralConfig of vault.collaterals ?? []) {
            const collateral = vaultMap.get(collateralConfig.collateral.toLowerCase());
            if (!collateral || !productSet.has(collateralConfig.collateral.toLowerCase())) continue;
            pairCount += 1;
            const ltv = Number(collateralConfig.borrowLTV) / 10_000; // basis points
            if (!ltv || ltv >= 1) continue;
            const collSupplyApy = (collateral.supplyApy ?? 0) + (intrinsicByAsset.get(collateral.asset.address.toLowerCase()) ?? 0);
            const debtBorrowApy = vault.borrowApy ?? 0;
            const lev = 1 / (1 - ltv);
            const roe = lev * collSupplyApy - (lev - 1) * debtBorrowApy;
            if (maxRoe === null || roe > maxRoe) {
              maxRoe = roe;
              maxRoePair = `${collateral.asset.symbol}/${vault.asset.symbol}`;
            }
          }
        }

        return {
          chainId: chain.chainId,
          chainName: chain.name,
          chainLabel: chain.label,
          slug,
          name: product.name || slug,
          description: product.description || '',
          entityNames: entitySlugs.map((entity) => entities[entity]?.name ?? entity),
          entityLogo: entityLogoUrl(entities[entitySlugs[0]]?.logo),
          totalSupplyUsd,
          totalBorrowedUsd,
          availableLiquidityUsd,
          assetCount: assets.size,
          pairCount,
          unknownVaults,
          maxRoe,
          maxRoePair,
          assets: Array.from(assets, ([address, symbol]) => ({ address, symbol })),
          memberAddresses: product.vaults,
          vaults
        };
      });
    });
  }, [chains, productsQueries, entitiesQueries, vaultsQueries, intrinsicQueries, vaultAddressesByChain]);

  const entityOptions = useMemo(() => Array.from(new Set(cards.flatMap((c) => c.entityNames))).sort(), [cards]);
  const assetOptions = useMemo(() => Array.from(new Set(cards.flatMap((c) => c.assets.map((a) => a.symbol)))).sort(), [cards]);

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = cards.filter((c) => {
      if (chainFilter !== 'all' && c.chainId !== chainFilter) return false;
      if (entityFilter.length > 0 && !c.entityNames.some((e) => entityFilter.includes(e))) return false;
      if (assetFilter.length > 0 && !c.assets.some((a) => assetFilter.includes(a.symbol))) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.chainName.toLowerCase().includes(q) ||
        c.chainLabel.toLowerCase().includes(q) ||
        c.entityNames.some((e) => e.toLowerCase().includes(q)) ||
        c.assets.some((a) => a.symbol.toLowerCase().includes(q))
      );
    });

    return filtered.sort((a, b) => {
      switch (sortMode) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'totalBorrowed':
          return b.totalBorrowedUsd - a.totalBorrowedUsd;
        case 'maxRoe':
          return (b.maxRoe ?? -Infinity) - (a.maxRoe ?? -Infinity);
        case 'totalSupply':
        case 'active':
        default:
          return b.totalSupplyUsd - a.totalSupplyUsd;
      }
    });
  }, [cards, search, sortMode, chainFilter, entityFilter, assetFilter]);

  const loading =
    cards.length === 0 &&
    (productsQueries.some((query) => query.isPending) ||
      vaultsQueries.some((query, index) => vaultAddressesByChain[index]?.length > 0 && query.isPending));

  const failedChains = chains.flatMap((chain, index) => {
    const failedResources: string[] = [];
    if (productsQueries[index]?.isError) failedResources.push('products');
    if (entitiesQueries[index]?.isError) failedResources.push('entities');
    if (intrinsicQueries[index]?.isError) failedResources.push('intrinsic APY');
    if (vaultsQueries[index]?.isError) failedResources.push('vaults');
    return failedResources.length > 0 ? [`${chain.label} (${failedResources.join(', ')})`] : [];
  });

  return (
    <Box sx={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 3, marginTop: 1 }}>
        <Avatar variant="rounded" sx={{ width: 56, height: 56, bgcolor: 'transparent', border: `1px solid ${theme.palette.divider}` }}>
          <HubOutlinedIcon sx={{ color: theme.palette.secondary.main }} />
        </Avatar>
        <Box>
          <Typography variant="h2">Explore</Typography>
          <Typography variant="body1" sx={{ color: theme.palette.grey[500] }}>
            Discover lending markets across Euler. Filter by asset, risk manager, or market type.
          </Typography>
        </Box>
      </Box>

      {/* Toolbar filters the combined market list from every configured network. */}
      <Grid container spacing={1.5} sx={{ marginBottom: 3 }} alignItems="center">
        <Grid size={{ xs: 12, md: 4.5 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search by asset, market, curator, network..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 1.8 }}>
          <Select fullWidth size="small" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="name">Name</MenuItem>
            <MenuItem value="totalSupply">Total supply</MenuItem>
            <MenuItem value="totalBorrowed">Total borrowed</MenuItem>
            <MenuItem value="maxRoe">Max ROE</MenuItem>
          </Select>
        </Grid>
        <Grid size={{ xs: 6, md: 1.7 }}>
          <ChainFilter value={chainFilter} onChange={setChainFilter} />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Autocomplete
            multiple
            size="small"
            options={entityOptions}
            value={entityFilter}
            onChange={(e, v) => setEntityFilter(v)}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip label={option} {...getTagProps({ index })} size="small" />)
            }
            renderInput={(params) => <TextField {...params} label="Risk manager" />}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <Autocomplete
            multiple
            size="small"
            options={assetOptions}
            value={assetFilter}
            onChange={(e, v) => setAssetFilter(v)}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip label={option} {...getTagProps({ index })} size="small" />)
            }
            renderInput={(params) => <TextField {...params} label="Asset" />}
          />
        </Grid>
      </Grid>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', padding: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {failedChains.length > 0 && (
        <Alert severity="warning" variant="outlined" sx={{ marginBottom: 2 }}>
          Some network data could not be loaded: {failedChains.join('; ')}.{cards.length > 0 ? ' Showing available markets.' : ''}
        </Alert>
      )}

      {!loading && visibleCards.length === 0 && (
        <Paper sx={{ padding: 3 }}>
          <Typography>{cards.length === 0 ? 'No markets are currently available.' : 'No markets match the current filters.'}</Typography>
        </Paper>
      )}

      <Stack spacing={2}>
        {visibleCards.map((card) => {
          const id = expansionId(card.chainId, card.slug);
          const resolved = resolvedSummaries[id];
          return (
            <Paper
              key={id}
              ref={(element: HTMLDivElement | null) => {
                if (element && pendingScrollId.current === id) {
                  pendingScrollId.current = null;
                  element.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }
              }}
              sx={{
                padding: '20px 24px',
                border: `1px solid ${theme.palette.divider}`,
                transition: 'border-color 0.2s',
                '&:hover': { borderColor: theme.palette.secondary.main }
              }}
            >
              <Box
                onClick={() => toggleExpanded(card.chainId, card.slug)}
                sx={{ cursor: 'pointer' }}
                role="button"
                aria-expanded={expandedSlugs.has(id)}
              >
                {/* Top: entity, name, description | assets/pairs */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, marginBottom: 2.5 }}>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', minWidth: 0 }}>
                    <Avatar src={card.entityLogo} sx={{ width: 44, height: 44, fontSize: 16 }}>
                      {(card.entityNames[0] || card.name).slice(0, 1)}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                          {card.entityNames.join(' & ')}
                        </Typography>
                        <ChainBadge chainId={card.chainId} />
                      </Stack>
                      <Typography variant="h3" sx={{ margin: '2px 0' }}>
                        {card.name}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          color: theme.palette.grey[500],
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: { xs: 2, sm: 1 },
                          overflow: 'hidden'
                        }}
                      >
                        {card.description}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexShrink: 0 }}>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" sx={{ color: theme.palette.grey[400] }}>
                        {resolved?.assetCount ?? card.assetCount} assets
                      </Typography>
                      <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                        {resolved?.pairCount ?? card.pairCount} pairs
                      </Typography>
                      {(resolved?.unknownVaults ?? card.unknownVaults) > 0 && (
                        <Typography variant="body2" color="error">
                          {resolved?.unknownVaults ?? card.unknownVaults} unknown
                        </Typography>
                      )}
                    </Box>
                    <ExpandMoreIcon
                      sx={{
                        color: theme.palette.grey[500],
                        transition: 'transform 0.2s',
                        transform: expandedSlugs.has(id) ? 'rotate(180deg)' : 'none'
                      }}
                    />
                  </Box>
                </Box>

                {/* Bottom: stats | asset icon cluster */}
                <Grid container spacing={2} alignItems="center">
                  <Grid size={{ xs: 6, sm: 3, md: 2.5 }}>
                    <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                      Total supply
                    </Typography>
                    <Typography variant="h4">${formatShortUSDS(resolved?.totalSupplyUsd ?? card.totalSupplyUsd)}</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3, md: 2.5 }}>
                    <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                      Total borrowed
                    </Typography>
                    <Typography variant="h4">${formatShortUSDS(resolved?.totalBorrowedUsd ?? card.totalBorrowedUsd)}</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3, md: 2.5 }}>
                    <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                      Available liquidity
                    </Typography>
                    <Typography variant="h4">${formatShortUSDS(resolved?.availableLiquidityUsd ?? card.availableLiquidityUsd)}</Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3, md: 2.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                        Max ROE
                      </Typography>
                      <Tooltip title="Estimated max return on equity for a leveraged loop at the pair's borrow LTV" arrow>
                        <InfoOutlinedIcon sx={{ fontSize: 14, color: theme.palette.grey[600] }} />
                      </Tooltip>
                    </Box>
                    {card.maxRoe !== null ? (
                      <Typography variant="h4">
                        {card.maxRoe.toFixed(2)}%{' '}
                        <Typography component="span" variant="body2" sx={{ color: theme.palette.grey[500] }}>
                          {card.maxRoePair}
                        </Typography>
                      </Typography>
                    ) : (
                      <Typography variant="h4" sx={{ color: theme.palette.grey[600] }}>
                        —
                      </Typography>
                    )}
                  </Grid>
                  <Grid size={{ xs: 12, sm: 12, md: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: { md: 'flex-end', xs: 'flex-start' } }}>
                      <AvatarGroup
                        max={8}
                        sx={{ '& .MuiAvatar-root': { width: 26, height: 26, fontSize: 10, border: `1px solid ${theme.palette.divider}` } }}
                      >
                        {card.assets.map((a) => (
                          <Tooltip key={a.address} title={a.symbol} arrow>
                            <Avatar src={tokenImageUrl(card.chainId, a.address)} alt={a.symbol}>
                              {a.symbol.slice(0, 2).toUpperCase()}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </AvatarGroup>
                    </Box>
                  </Grid>
                </Grid>
              </Box>
              {expandedSlugs.has(id) && (
                <Box sx={{ marginTop: 2.5, paddingTop: 2.5, borderTop: `1px solid ${theme.palette.divider}` }}>
                  <ExploreMarketExperience
                    chainId={card.chainId}
                    marketId={card.slug}
                    memberAddresses={card.memberAddresses}
                    vaults={card.vaults}
                    onResolvedSummary={(summary) => updateResolvedSummary(id, summary)}
                  />
                </Box>
              )}
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}
