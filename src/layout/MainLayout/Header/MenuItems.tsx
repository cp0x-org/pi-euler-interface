import React from 'react';
import { Link as RouterLink } from 'react-router-dom';

// material-ui
import { Box, Button, Stack, Theme, useMediaQuery, useTheme } from '@mui/material';

// project imports
import useTranslate from 'hooks/useTranslate';

// Menu button styling as an object for reuse
const menuButtonStyle = (theme: Theme) => ({
  color: theme.palette.text.primary,
  fontWeight: 500,
  fontSize: '15px',
  textTransform: 'none',
  padding: '6px 16px',
  borderRadius: '8px',
  '&:hover': {
    backgroundColor: theme.palette.primary.light,
    color: theme.palette.primary.main
  }
});

const MenuItems = () => {
  const theme = useTheme();
  const t = useTranslate();
  const matchDownMd = useMediaQuery(theme.breakpoints.down('md'));

  if (matchDownMd) return null;

  return (
    <Box component="nav" aria-label={t('site.linksLabel', 'cp0x site links')} sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
      <Stack component="ul" direction="row" spacing={1} sx={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {/* Internal link using RouterLink */}
        <Box component="li" sx={{ display: 'flex' }}>
          <Button component={RouterLink} to="/" sx={menuButtonStyle(theme)}>
            {t('site.home', 'Home')}
          </Button>
        </Box>

        {/* External links using anchor tags */}
        <Box component="li" sx={{ display: 'flex' }}>
          <Button href="https://pi.cp0x.com" rel="noopener noreferrer" sx={menuButtonStyle(theme)}>
            {t('site.permissionlessInterfaces', 'Permissionless Interfaces')}
          </Button>
        </Box>

        <Box component="li" sx={{ display: 'flex' }}>
          <Button href="https://cp0x.com" target="_blank" rel="noopener noreferrer" sx={menuButtonStyle(theme)}>
            {t('site.referrals', 'cp0x Referrals')}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
};

export default MenuItems;
