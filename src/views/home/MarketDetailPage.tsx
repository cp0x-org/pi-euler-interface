import { useParams, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import { Typography, Paper, Tooltip, IconButton, Stack, useTheme, Card, Divider } from '@mui/material';
import Grid from '@mui/material/Grid';

import { formatLLTV, formatShortUSDS } from '@/utils/formatters';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import ActionFormsSecondary from 'views/home/market/ActionFormsSecondary';
import { useCopyToClipboard } from 'hooks/useCopyToClipboard';
import { useAccount, useSwitchChain } from 'wagmi';
import { dispatchInfo, dispatchSuccess, dispatchError } from 'utils/snackbar';
import { getChainName } from 'utils/chains';
import { TokenIcon } from 'components/TokenIcon';
import useTranslate from 'hooks/useTranslate';
import { ArrowRightAlt } from '@mui/icons-material';
import ActionFormsMain from 'views/home/market/ActionFormsMain';
import { mockMarkets } from 'mocks/markets';

// Mock user position rendered on this page; future values are recomputed
// locally from form input so the before/after arrows still animate.
interface MockPosition {
  borrowAssets: bigint;
  collateral: bigint;
  ltv: bigint; // 1e18-scaled
}

export default function MarketDetailPage() {
  const t = useTranslate();
  const theme = useTheme();

  const { marketId } = useParams<{ marketId: string }>();
  const [searchParams] = useSearchParams();
  const targetChainId = Number(searchParams.get('chainId')) || undefined;
  const { copySuccessMsg, copyToClipboard } = useCopyToClipboard();
  const { chainId: currentChainId } = useAccount();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    if (targetChainId && currentChainId && currentChainId !== targetChainId) {
      const networkName = getChainName(targetChainId);
      dispatchInfo(`Switching network to ${networkName}...`);
      switchChain(
        { chainId: targetChainId },
        {
          onSuccess: () => dispatchSuccess(`Switched to ${networkName}`),
          onError: (err) => dispatchError(`Failed to switch to ${networkName}: ${err.message}`)
        }
      );
    }
  }, [targetChainId, currentChainId, switchChain]);

  const [diffBorrowAmount, setDiffBorrowAmount] = useState<bigint>(0n);
  const [diffCollateralAmount, setDiffCollateralAmount] = useState<bigint>(0n);

  // Mock data (see src/mocks) — replace with real API calls when wiring a protocol
  const marketData = mockMarkets.find((m) => m.marketId === marketId);

  const accrualPosition: MockPosition | null = useMemo(() => {
    if (!marketData) return null;
    return {
      borrowAssets: parseUnits('4200', marketData.loanAsset.decimals),
      collateral: parseUnits('2.5', marketData.collateralAsset.decimals),
      ltv: parseUnits('0.35', 18)
    };
  }, [marketData]);

  const isChanged = diffBorrowAmount !== 0n || diffCollateralAmount !== 0n;

  const futurePosition: MockPosition | null = useMemo(() => {
    if (!marketData || !accrualPosition || !isChanged) return null;
    const borrowAssets = accrualPosition.borrowAssets + diffBorrowAmount;
    const collateral = accrualPosition.collateral + diffCollateralAmount;
    const borrowRatio = accrualPosition.borrowAssets > 0n ? Number(borrowAssets) / Number(accrualPosition.borrowAssets) : 0;
    const collateralRatio = collateral > 0n ? Number(accrualPosition.collateral) / Number(collateral) : 0;
    const ltv = BigInt(Math.max(Math.round(Number(accrualPosition.ltv) * borrowRatio * collateralRatio), 0));
    return { borrowAssets, collateral, ltv };
  }, [marketData, accrualPosition, isChanged, diffBorrowAmount, diffCollateralAmount]);

  const onBorrowAmountChange = useCallback((amount: bigint) => {
    setDiffBorrowAmount(amount);
  }, []);

  const onCollateralAmountChange = useCallback((amount: bigint) => {
    setDiffCollateralAmount(amount);
  }, []);

  if (!marketData) {
    return (
      <Box sx={{ padding: 2 }}>
        <Typography variant="h5" color="error">
          {t('market.notFound', 'Market not found')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ padding: '16px 0px' }}>
      {/* Market header — compact top bar */}
      <Paper sx={{ padding: '20px 24px', marginBottom: 3 }}>
        <Grid container alignItems="center" spacing={3}>
          {/* Token pair */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {marketData.collateralAsset?.symbol && (
                  <TokenIcon
                    sx={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', zIndex: 1 }}
                    avatarProps={{ sx: { width: 38, height: 38 } }}
                    symbol={marketData.collateralAsset?.symbol}
                  />
                )}
                {marketData.loanAsset?.symbol && (
                  <TokenIcon
                    sx={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', ml: '-18px', zIndex: 2 }}
                    avatarProps={{ sx: { width: 38, height: 38 } }}
                    symbol={marketData.loanAsset?.symbol}
                  />
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                <Typography variant="h3" component="span" sx={{ display: 'inline' }}>
                  {marketData.collateralAsset?.symbol || 'N/A'}
                </Typography>
                {marketData.collateralAsset?.address && (
                  <Tooltip title={copySuccessMsg || t('common.copyAddress', 'Copy address')} placement="top">
                    <IconButton onClick={() => copyToClipboard(marketData.collateralAsset?.address || '')} sx={{ padding: '3px' }}>
                      <ContentCopyIcon sx={{ fontSize: '16px', color: theme.palette.grey[500] }} />
                    </IconButton>
                  </Tooltip>
                )}
                <Typography variant="h3" sx={{ display: 'inline', mx: 1, color: theme.palette.grey[500] }}>
                  /
                </Typography>
                <Typography variant="h3" component="span" sx={{ display: 'inline' }}>
                  {marketData.loanAsset?.symbol || 'N/A'}
                </Typography>
                {marketData.loanAsset?.address && (
                  <Tooltip title={copySuccessMsg || t('common.copyAddress', 'Copy address')} placement="top">
                    <IconButton onClick={() => copyToClipboard(marketData.loanAsset?.address || '')} sx={{ padding: '3px' }}>
                      <ContentCopyIcon sx={{ fontSize: '16px', color: theme.palette.grey[500] }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          </Grid>

          {/* Market stats */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Grid container spacing={1}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Stack spacing={0.5}>
                  <Typography variant="h4">{`${((marketData.state?.utilization || 0) * 100).toFixed(2)}%`}</Typography>
                  <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                    {t('common.utilization', 'Utilization')}
                  </Typography>
                </Stack>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Stack spacing={0.5}>
                  <Typography variant="h4">{marketData.state.sizeUsd ? formatShortUSDS(marketData.state.sizeUsd) : 'n/a'}</Typography>
                  <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                    {t('market.size', 'Market Size')}
                  </Typography>
                </Stack>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Stack spacing={0.5}>
                  <Typography variant="h4">
                    {marketData.state.totalLiquidityUsd ? formatShortUSDS(marketData.state.totalLiquidityUsd) : 'n/a'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                    {t('common.liquidity', 'Liquidity')}
                  </Typography>
                </Stack>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Stack spacing={0.5}>
                  <Typography variant="h4">
                    {marketData.state.dailyNetBorrowApy ? `${(marketData.state.dailyNetBorrowApy * 100).toFixed(2)}%` : 'n/a'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: theme.palette.grey[500] }}>
                    {t('market.borrowRate', 'Borrow Rate')}
                  </Typography>
                </Stack>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Paper>

      {/* Main content: forms left, position right (sticky) */}
      <Grid container spacing={3} alignItems="flex-start">
        {/* Left: action forms stacked */}
        <Grid size={{ xs: 12, md: 7 }}>
          <ActionFormsMain
            market={marketData}
            marketId={marketId}
            onBorrowAmountChange={onBorrowAmountChange}
            onCollateralAmountChange={onCollateralAmountChange}
          />
          <ActionFormsSecondary market={marketData} marketId={marketId} onBorrowAmountChange={() => {}} onLoanAmountChange={() => {}} />
        </Grid>

        {/* Right: position summary, sticky */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ position: 'sticky', top: '24px' }}>
            {accrualPosition ? (
              <Paper>
                <Typography variant="h4" gutterBottom sx={{ marginBottom: '24px' }}>
                  {t('market.yourPosition', 'Your Position')}
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Card
                      sx={{
                        ...theme.applyStyles('dark', {
                          bgcolor: 'background.default',
                          border: 'none',
                          borderRadius: '12px',
                          padding: '20px'
                        })
                      }}
                    >
                      <Stack spacing={'20px'}>
                        <Typography variant="h5" sx={{ fontWeight: 400, color: theme.palette.grey[500] }}>
                          {t('market.loanOf', 'Loan ({symbol})', { symbol: marketData.loanAsset?.symbol ?? '' })}
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="h3" sx={{ color: isChanged ? theme.palette.grey[500] : 'inherit' }}>
                            {accrualPosition.borrowAssets
                              ? parseFloat(formatUnits(accrualPosition.borrowAssets, marketData.loanAsset?.decimals || 18)).toFixed(4)
                              : '0'}
                          </Typography>
                          {isChanged && futurePosition && (
                            <>
                              <ArrowRightAlt style={{ color: theme.palette.grey[500] }} />
                              <Typography variant="h3">
                                {futurePosition?.borrowAssets
                                  ? futurePosition?.borrowAssets <= 0
                                    ? '0'
                                    : parseFloat(formatUnits(futurePosition?.borrowAssets, marketData.loanAsset?.decimals || 18)).toFixed(4)
                                  : '0'}
                              </Typography>
                            </>
                          )}
                        </Box>
                      </Stack>
                    </Card>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Card
                      sx={{
                        ...theme.applyStyles('dark', {
                          bgcolor: 'background.default',
                          border: 'none',
                          borderRadius: '12px',
                          padding: '20px'
                        })
                      }}
                    >
                      <Stack spacing={'20px'}>
                        <Typography variant="h5" sx={{ fontWeight: 400, color: theme.palette.grey[500] }}>
                          {t('market.collateralOf', 'Collateral ({symbol})', { symbol: marketData.collateralAsset?.symbol ?? '' })}
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="h3" sx={{ color: isChanged ? theme.palette.grey[500] : 'inherit' }}>
                            {accrualPosition.collateral
                              ? parseFloat(formatUnits(accrualPosition.collateral, marketData.collateralAsset?.decimals || 18)).toFixed(4)
                              : '0'}
                          </Typography>
                          {isChanged && futurePosition && (
                            <>
                              <ArrowRightAlt style={{ color: theme.palette.grey[500] }} />
                              <Typography variant="h3">
                                {futurePosition?.collateral
                                  ? futurePosition?.collateral <= 0
                                    ? '0'
                                    : parseFloat(
                                        formatUnits(futurePosition?.collateral, marketData.collateralAsset?.decimals || 18)
                                      ).toFixed(4)
                                  : '0'}
                              </Typography>
                            </>
                          )}
                        </Box>
                      </Stack>
                    </Card>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Card
                      sx={{
                        ...theme.applyStyles('dark', {
                          bgcolor: 'background.default',
                          border: 'none',
                          borderRadius: '12px',
                          padding: '20px'
                        })
                      }}
                    >
                      <Stack spacing={'20px'}>
                        <Typography variant="h5" sx={{ fontWeight: 400, color: theme.palette.grey[500] }}>
                          {t('market.ltvPercent', 'LTV (%)')}
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="h3" sx={{ color: isChanged ? theme.palette.grey[500] : 'inherit' }}>
                            {accrualPosition.ltv ? (parseFloat(formatUnits(accrualPosition?.ltv, 18)) * 100).toFixed(2) : '0'}
                          </Typography>
                          {isChanged && futurePosition && (
                            <>
                              <ArrowRightAlt style={{ color: theme.palette.grey[500] }} />
                              <Typography variant="h3">
                                {futurePosition?.ltv
                                  ? futurePosition?.ltv <= 0
                                    ? '0'
                                    : (parseFloat(formatUnits(futurePosition?.ltv, 18)) * 100).toFixed(2)
                                  : '0'}
                              </Typography>
                            </>
                          )}
                        </Box>
                      </Stack>
                    </Card>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Card
                      sx={{
                        ...theme.applyStyles('dark', {
                          bgcolor: 'background.default',
                          border: 'none',
                          borderRadius: '12px',
                          padding: '20px'
                        })
                      }}
                    >
                      <Stack spacing={'20px'}>
                        <Typography variant="h5" sx={{ fontWeight: 400, color: theme.palette.grey[500] }}>
                          LLTV
                        </Typography>
                        <Typography variant="h3">
                          {formatLLTV(marketData.lltv) ? formatLLTV(marketData.lltv)?.toFixed(2) + '%' : 'n/a'}
                        </Typography>
                      </Stack>
                    </Card>
                  </Grid>
                </Grid>
              </Paper>
            ) : (
              <Paper>
                <Typography variant="h4" gutterBottom sx={{ marginBottom: '16px' }}>
                  {t('market.yourPosition', 'Your Position')}
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" sx={{ color: theme.palette.grey[500] }}>
                  {t('market.noPosition', 'You have no open position in this market.')}
                </Typography>
              </Paper>
            )}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
