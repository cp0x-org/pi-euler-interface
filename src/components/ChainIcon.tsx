import {
  NetworkArbitrumOne,
  NetworkAvalanche,
  NetworkBase,
  NetworkBinanceSmartChain,
  NetworkEthereum,
  NetworkHyperEvm,
  NetworkLinea,
  NetworkMonad,
  NetworkPlasma,
  NetworkPolygon,
  NetworkUnichain
} from '@web3icons/react';
import { Avatar, Chip, ChipProps, Tooltip, Typography } from '@mui/material';
import Box, { BoxProps } from '@mui/material/Box';
import React from 'react';
import { getChainName } from 'utils/chains';

interface ChainIconProps extends BoxProps {
  chainId: number;
  showName?: boolean;
  size?: number;
  tooltip?: boolean;
}

const CHAIN_LOGOS = {
  1: NetworkEthereum,
  8453: NetworkBase,
  42161: NetworkArbitrumOne,
  130: NetworkUnichain,
  137: NetworkPolygon,
  56: NetworkBinanceSmartChain,
  43114: NetworkAvalanche,
  143: NetworkMonad,
  999: NetworkHyperEvm,
  9745: NetworkPlasma,
  59144: NetworkLinea
};

export const ChainIcon: React.FC<ChainIconProps> = ({ chainId, showName = false, size = 24, tooltip = true, ...boxProps }) => {
  if (!chainId) return null;

  const name = getChainName(chainId);
  const Logo = CHAIN_LOGOS[chainId as keyof typeof CHAIN_LOGOS];
  const icon = Logo ? (
    <Logo variant="background" size={size} aria-label={`${name} logo`} />
  ) : (
    <Avatar alt={name} sx={{ width: size, height: size, fontSize: Math.max(size * 0.45, 9) }}>
      {name.slice(0, 1).toUpperCase()}
    </Avatar>
  );

  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, lineHeight: 0 }} {...boxProps}>
      {tooltip ? (
        <Tooltip title={name} arrow>
          <Box component="span" sx={{ display: 'inline-flex', width: size, height: size }}>
            {icon}
          </Box>
        </Tooltip>
      ) : (
        icon
      )}
      {showName && (
        <Typography component="span" variant="inherit" sx={{ lineHeight: 1.2 }}>
          {name}
        </Typography>
      )}
    </Box>
  );
};

interface ChainBadgeProps extends Omit<ChipProps, 'icon' | 'label'> {
  chainId: number;
}

export function ChainBadge({ chainId, size = 'small', variant = 'outlined', sx, ...chipProps }: ChainBadgeProps) {
  return (
    <Chip
      icon={<ChainIcon chainId={chainId} size={18} tooltip={false} />}
      label={getChainName(chainId)}
      aria-label={`Network: ${getChainName(chainId)}`}
      size={size}
      variant={variant}
      sx={{
        height: 24,
        '& .MuiChip-icon': { marginLeft: 0.5 },
        '& .MuiChip-label': { paddingLeft: 0.5 },
        ...sx
      }}
      {...chipProps}
    />
  );
}
