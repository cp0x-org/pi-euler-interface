import { useId } from 'react';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import { Box, FormControl, FormControlProps, InputLabel, MenuItem, Select, SelectChangeEvent } from '@mui/material';

import { getRuntimeConfig } from '@/appconfig/runtime';
import { ChainIcon } from 'components/ChainIcon';
import useTranslate from 'hooks/useTranslate';

export type ChainFilterValue = 'all' | number;

interface ChainFilterProps extends Omit<FormControlProps, 'onChange'> {
  value: ChainFilterValue;
  onChange: (value: ChainFilterValue) => void;
}

export default function ChainFilter({ value, onChange, fullWidth = true, ...formControlProps }: ChainFilterProps) {
  const labelId = useId();
  const t = useTranslate();
  const { chains } = getRuntimeConfig();

  const handleChange = (event: SelectChangeEvent<ChainFilterValue>) => {
    const next = event.target.value;
    onChange(next === 'all' ? 'all' : Number(next));
  };

  return (
    <FormControl fullWidth={fullWidth} size="small" {...formControlProps}>
      <InputLabel id={labelId}>{t('common.network', 'Network')}</InputLabel>
      <Select<ChainFilterValue>
        labelId={labelId}
        label={t('common.network', 'Network')}
        value={value}
        onChange={handleChange}
        renderValue={(selected) =>
          selected === 'all' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <PublicOutlinedIcon sx={{ fontSize: 18 }} />
              {t('common.allNetworks', 'All networks')}
            </Box>
          ) : (
            <ChainIcon chainId={selected} showName size={18} tooltip={false} />
          )
        }
      >
        <MenuItem value="all">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <PublicOutlinedIcon sx={{ fontSize: 18 }} />
            {t('common.allNetworks', 'All networks')}
          </Box>
        </MenuItem>
        {chains.map((chain) => (
          <MenuItem key={chain.chainId} value={chain.chainId}>
            <ChainIcon chainId={chain.chainId} showName size={18} tooltip={false} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
