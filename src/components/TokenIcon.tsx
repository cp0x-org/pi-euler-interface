import Box, { BoxProps } from '@mui/material/Box';
import { Avatar, AvatarProps } from '@mui/material';
import React from 'react';

interface TokenIconProps extends BoxProps {
  symbol: string;
  logoUrl?: string; // real icon source; letter avatar is the fallback
  avatarProps?: AvatarProps; // lets callers customise the Avatar
}

// Renders the token logo when logoUrl is given (e.g. token-images.euler.finance),
// otherwise a letter avatar from the token symbol.
// The mark is decorative: every call site renders the token symbol as text right next to it, so
// exposing the logo again would only duplicate that text in the accessibility tree.
export const TokenIcon: React.FC<TokenIconProps> = ({ symbol, logoUrl, avatarProps, ...boxProps }) => {
  if (!symbol) {
    return null;
  }

  return (
    <Box aria-hidden="true" sx={{ display: 'flex', alignItems: 'center', gap: 1 }} {...boxProps}>
      <Avatar src={logoUrl} alt="" sx={{ width: 36, height: 36, fontSize: 14, ...avatarProps?.sx }} {...avatarProps}>
        {symbol.slice(0, 2).toUpperCase()}
      </Avatar>
    </Box>
  );
};
