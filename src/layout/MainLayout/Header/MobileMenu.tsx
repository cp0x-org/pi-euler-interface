import React, { useId, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

// material-ui
import { Box, IconButton, Drawer, List, ListItemButton, ListItemText, Typography, useTheme } from '@mui/material';
import { IconMenu2, IconX } from '@tabler/icons-react';

// project imports
import useTranslate from 'hooks/useTranslate';

// types
interface MobileMenuItemProps {
  title: string;
  path?: string;
  isExternal?: boolean;
}

const MobileMenu = () => {
  const theme = useTheme();
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const titleId = useId();

  const handleToggleDrawer = () => {
    setOpen(!open);
  };

  const menuItems: MobileMenuItemProps[] = [
    {
      title: t('site.home', 'Home'),
      path: '/',
      isExternal: false
    },
    {
      title: t('site.permissionlessInterfaces', 'Permissionless Interfaces'),
      path: 'https://pi.cp0x.com',
      isExternal: false
    },
    {
      title: t('site.referrals', 'cp0x Referrals'),
      path: 'https://cp0x.com',
      isExternal: true
    }
  ];

  return (
    <Box sx={{ display: { xs: 'block', md: 'none' } }}>
      <IconButton
        color="inherit"
        onClick={handleToggleDrawer}
        edge="start"
        size="large"
        aria-label={t('site.openMenu', 'Open site menu')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? drawerId : undefined}
      >
        <IconMenu2 aria-hidden="true" focusable="false" />
      </IconButton>

      <Drawer
        anchor="right"
        open={open}
        onClose={handleToggleDrawer}
        PaperProps={{
          id: drawerId,
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          sx: {
            width: '280px',
            background: theme.palette.background.default
          }
        }}
      >
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography id={titleId} variant="h6" component="h2">
            {t('site.menu', 'Menu')}
          </Typography>
          <IconButton
            color="inherit"
            onClick={handleToggleDrawer}
            edge="end"
            size="small"
            aria-label={t('site.closeMenu', 'Close site menu')}
          >
            <IconX aria-hidden="true" focusable="false" />
          </IconButton>
        </Box>

        <List component="nav" aria-label={t('site.linksLabel', 'cp0x site links')} sx={{ px: 2, pt: 1 }}>
          {menuItems.map((item) => (
            <React.Fragment key={item.title}>
              {item.isExternal ? (
                <ListItemButton component="a" href={item.path} target="_blank" rel="noopener noreferrer" onClick={handleToggleDrawer}>
                  <ListItemText primary={item.title} />
                </ListItemButton>
              ) : (
                <ListItemButton component={RouterLink} to={item.path || '#'} onClick={handleToggleDrawer}>
                  <ListItemText primary={item.title} />
                </ListItemButton>
              )}
            </React.Fragment>
          ))}
        </List>
      </Drawer>
    </Box>
  );
};

export default MobileMenu;
