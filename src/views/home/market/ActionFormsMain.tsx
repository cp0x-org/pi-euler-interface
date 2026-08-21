import Box from '@mui/material/Box';
import { Typography, Paper, Tabs, Tab } from '@mui/material';
import React, { useState } from 'react';
import { MarketInterface } from 'types/market';
import { TabPanel, AddTab, BorrowTab, RepayTab, WithdrawCollateralTab } from './components';
import { useTheme } from '@mui/material/styles';
import useTranslate from 'hooks/useTranslate';

interface MarketProps {
  market?: MarketInterface;
  marketId?: string;
  onPositionUpdate?: () => void;
  onBorrowAmountChange: (amount: bigint) => void;
  onCollateralAmountChange: (amount: bigint) => void;
}

export default function ActionFormsMain(props: MarketProps) {
  const theme = useTheme();
  const t = useTranslate();
  const marketId = props.marketId;
  const market = props.market;
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    props.onBorrowAmountChange(0n);
    props.onCollateralAmountChange(0n);
  };

  if (!marketId || !market) {
    return (
      <Box sx={{ padding: 2 }}>
        <Typography variant="h5" color="error">
          {t('market.notFound', 'Market not found')}
        </Typography>
      </Box>
    );
  }

  return (
    <Paper sx={{ mb: 3, backgroundColor: 'background.default' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          variant="fullWidth"
          sx={{
            '& .MuiTab-root': {
              minWidth: 0,
              px: 1.5,
              fontSize: '14px'
            }
          }}
        >
          <Tab label={t('market.tab.addCollateral', 'Add Collateral')} />
          <Tab label={t('common.borrow', 'Borrow')} />
          <Tab label={t('common.repay', 'Repay')} />
          <Tab label={t('market.tab.withdrawCollateral', 'Withdraw Collateral')} />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0} sx={{ bgcolor: theme.palette.background.paper }}>
        <AddTab
          market={market}
          marketId={marketId}
          onSuccess={props.onPositionUpdate}
          onBorrowAmountChange={props.onBorrowAmountChange}
          onCollateralAmountChange={props.onCollateralAmountChange}
        />
      </TabPanel>

      {/* Borrow Tab */}
      <TabPanel value={tabValue} index={1} sx={{ bgcolor: theme.palette.background.paper }}>
        <BorrowTab
          market={market}
          onSuccess={props.onPositionUpdate}
          onBorrowAmountChange={props.onBorrowAmountChange}
          onCollateralAmountChange={props.onCollateralAmountChange}
        />
      </TabPanel>

      {/* Repay Tab */}
      <TabPanel value={tabValue} index={2} sx={{ bgcolor: theme.palette.background.paper }}>
        <RepayTab
          market={market}
          marketId={marketId}
          onSuccess={props.onPositionUpdate}
          onBorrowAmountChange={props.onBorrowAmountChange}
          onCollateralAmountChange={props.onCollateralAmountChange}
        />
      </TabPanel>

      {/* Withdraw Tab */}
      <TabPanel value={tabValue} index={3} sx={{ bgcolor: theme.palette.background.paper }}>
        <WithdrawCollateralTab
          market={market}
          marketId={marketId}
          onSuccess={props.onPositionUpdate}
          onBorrowAmountChange={props.onBorrowAmountChange}
          onCollateralAmountChange={props.onCollateralAmountChange}
        />
      </TabPanel>
    </Paper>
  );
}
