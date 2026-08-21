import Box from '@mui/material/Box';
import { Typography } from '@mui/material';
import Button from '@mui/material/Button';
import React, { FC, useState } from 'react';
import { parseUnits } from 'viem';
import { useTheme } from '@mui/material/styles';
import { dispatchSuccess } from 'utils/snackbar';
import { TokenIcon } from 'components/TokenIcon';
import { CustomInput } from 'components/CustomInput';
import useTranslate from 'hooks/useTranslate';
import { formatAssetOutput, normalizePointAmount } from 'utils/formatters';

interface MockActionFormProps {
  title: string;
  subtitle: string;
  actionLabel: string;
  assetSymbol: string;
  assetDecimals: number;
  balance: string; // in token units, e.g. '10000'
  onAmountChange?: (amount: bigint) => void;
}

// Mock action form: keeps the input/percent/submit layout of the original
// transaction tabs, but submits nothing — the button just shows a snackbar.
// Wire real transaction logic here when integrating a protocol.
export const MockActionForm: FC<MockActionFormProps> = ({
  title,
  subtitle,
  actionLabel,
  assetSymbol,
  assetDecimals,
  balance,
  onAmountChange
}) => {
  const theme = useTheme();
  const t = useTranslate();
  const [inputAmount, setInputAmount] = useState('');
  const [activePercentage, setActivePercentage] = useState<number | null>(null);

  const emitAmount = (val: string) => {
    if (!onAmountChange) return;
    try {
      onAmountChange(parseUnits(val ? normalizePointAmount(val) : '0', assetDecimals));
    } catch {
      onAmountChange(0n);
    }
  };

  const handleInputChange = (raw: string) => {
    const val = formatAssetOutput(raw);
    setInputAmount(val);
    if (activePercentage !== null) {
      setActivePercentage(null);
    }
    emitAmount(val);
  };

  const handlePercentClick = (percent: number) => {
    const amount = ((parseFloat(balance) * percent) / 100).toString();
    setInputAmount(amount);
    setActivePercentage(percent);
    emitAmount(amount);
  };

  const parsedAmount = parseFloat(normalizePointAmount(inputAmount) || '0');
  const isButtonDisabled = !parsedAmount || parsedAmount <= 0 || parsedAmount > parseFloat(balance);

  const handleSubmit = () => {
    dispatchSuccess(
      t('market.mockSubmitted', 'Mock: {action} {amount} {symbol} submitted', {
        action: actionLabel,
        amount: inputAmount,
        symbol: assetSymbol
      })
    );
    setInputAmount('');
    setActivePercentage(null);
    emitAmount('');
  };

  return (
    <Box sx={{ maxWidth: '100%', margin: '0 auto' }}>
      <Box
        sx={{
          width: '100%',
          padding: '0px 20px',
          border: '1px solid',
          borderRadius: '12px',
          borderColor: theme.palette.grey[800],
          backgroundColor: theme.palette.background.paper,
          zIndex: 2,
          position: 'relative'
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            height: '80px',
            alignItems: 'center',
            marginBottom: '20px',
            marginTop: '15px'
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              height: '100%',
              width: '100%'
            }}
          >
            <Typography variant="body2" color="text.main" fontWeight="bold">
              {title}
            </Typography>
            <Typography variant="body2">{subtitle}</Typography>
          </Box>
          <Box
            sx={{
              paddingRight: '20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            <TokenIcon
              sx={{ width: '45px', height: '45px', display: 'flex', alignItems: 'center', zIndex: 1, marginBottom: '15px' }}
              avatarProps={{ sx: { width: 45, height: 45 } }}
              symbol={assetSymbol}
            />
            <Typography fontWeight="bold">{assetSymbol}</Typography>
          </Box>
        </Box>
        <CustomInput
          type="text"
          fullWidth
          value={inputAmount}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="0"
          inputProps={{ inputMode: 'decimal', pattern: '[0-9]*,?[0-9]*' }}
        />
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          {[25, 50, 75, 100].map((percent) => (
            <Button
              key={percent}
              variant="outlined"
              size="small"
              onClick={() => handlePercentClick(percent)}
              sx={{
                flex: 1,
                bgcolor: activePercentage === percent ? theme.palette.secondary.main : 'transparent',
                color: activePercentage === percent ? theme.palette.background.paper : 'inherit'
              }}
            >
              {percent === 100 ? t('common.max', 'Max') : `${percent}%`}
            </Button>
          ))}
        </Box>
      </Box>

      <Box
        sx={{
          width: '100%',
          padding: '25px 20px',
          border: '1px solid',
          borderTop: 'none',
          borderBottomLeftRadius: '12px',
          borderBottomRightRadius: '12px',
          borderColor: theme.palette.grey[800],
          mt: '-25px'
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            backgroundColor: theme.palette.background.paper,
            margin: '10px 0'
          }}
        >
          <Typography variant="h4" fontWeight="normal">
            {t('market.balanceLabel', 'Balance:')}
          </Typography>
          <Typography variant="h4" fontWeight="normal">
            {Number(balance).toFixed(6)} {assetSymbol}
          </Typography>
        </Box>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSubmit}
          disabled={isButtonDisabled}
          sx={{
            height: '58px',
            width: '100%',
            marginTop: '20px',
            fontFamily: 'Roboto, Arial, sans-serif',
            fontSize: '18px',
            fontWeight: 700
          }}
        >
          {actionLabel}
        </Button>
      </Box>
    </Box>
  );
};
