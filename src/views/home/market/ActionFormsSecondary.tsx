import Box from '@mui/material/Box';
import { Typography, Paper, Tabs, Tab } from '@mui/material';
import React, { useState } from 'react';
import { MarketInterface } from 'types/market';
import { TabPanel, WithdrawTab, SupplyTab } from './components';
import { useTheme } from '@mui/material/styles';
import useTranslate from 'hooks/useTranslate';

interface MarketProps {
  market?: MarketInterface;
  marketId?: string;
  onPositionUpdate?: () => void;
  onBorrowAmountChange: (amount: bigint) => void;
  onLoanAmountChange: (amount: bigint) => void;
}

export default function ActionFormsSecondary(props: MarketProps) {
  const theme = useTheme();
  const t = useTranslate();
  const marketId = props.marketId;
  const market = props.market;
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    props.onBorrowAmountChange(0n);
    props.onLoanAmountChange(0n);
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
          <Tab label={t('common.supply', 'Supply')} />
          <Tab label={t('common.withdraw', 'Withdraw')} />
        </Tabs>
      </Box>

      {/* Supply Tab */}
      <TabPanel value={tabValue} index={0} sx={{ bgcolor: theme.palette.background.paper }}>
        <SupplyTab
          market={market}
          marketId={marketId}
          onSuccess={props.onPositionUpdate}
          onBorrowAmountChange={props.onBorrowAmountChange}
          onCollateralAmountChange={props.onLoanAmountChange}
        />
      </TabPanel>

      {/* Withdraw Tab */}
      <TabPanel value={tabValue} index={1} sx={{ bgcolor: theme.palette.background.paper }}>
        <WithdrawTab
          market={market}
          marketId={marketId}
          onSuccess={props.onPositionUpdate}
          onBorrowAmountChange={props.onBorrowAmountChange}
          onLoanAmountChange={props.onLoanAmountChange}
        />
      </TabPanel>
    </Paper>
  );
}
