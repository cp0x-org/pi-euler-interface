import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

// material-ui
import { styled, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import AppBar from '@mui/material/AppBar';
import Container from '@mui/material/Container';
import Toolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';

// project imports
import Footer from './Footer';
import Header from './Header';
import MainContentStyled from './MainContentStyled';
import Loader from 'ui-component/Loader';
import Breadcrumbs from 'ui-component/extended/Breadcrumbs';

import { MenuOrientation, ThemeMode } from 'config';
import useConfig from 'hooks/useConfig';
import { handlerDrawerOpen, useGetMenuMaster } from 'api/menu';
import Tabs from '@mui/material/Tabs';
import Tab, { TabProps } from '@mui/material/Tab';
import MainCard from '../../ui-component/cards/MainCard';
import useTranslate from 'hooks/useTranslate';

// ==============================|| MAIN LAYOUT ||============================== //

// icon tab style
const AntTabs = styled(Tabs)(({ theme }) => ({
  background: theme.palette.mode === ThemeMode.DARK ? theme.palette.dark[800] : theme.palette.primary.light,
  width: 'fit-content',
  maxWidth: '100%',
  borderBottom: 'none', // remove the border
  '& .MuiTabs-flexContainer': {
    border: '1px solid',
    borderRadius: '12px',
    borderColor: '#3F3F3F',
    height: '61px'
  },
  '& .MuiTabs-scroller': {
    borderBottom: 'none'
  },
  borderRadius: '12px',
  boxShadow: 'none',
  '& .MuiTabs-indicator': {
    backgroundColor: theme.palette.secondary.main,
    height: 0 // hide the active tab indicator
  },
  [theme.breakpoints.down('sm')]: {
    width: '100%',
    '& .MuiTabs-flexContainer': {
      height: '48px'
    }
  }
}));

// style constant
const AntTab = styled((props: TabProps) => <Tab disableRipple {...props} />)(({ theme }) => ({
  textTransform: 'none',
  minWidth: 0,
  fontWeight: theme.typography.fontWeightRegular,
  fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  // fontWeight: 500, // Medium
  fontSize: '16px',
  color: theme.palette.grey[100],
  '&.MuiTab-root': {
    borderRight: '1px solid #3F3F3F',
    borderColor: '#3F3F3F',
    minWidth: '125px'
  },
  '&:hover': {
    color: theme.palette.grey[500],
    opacity: 1
  },
  '&.Mui-selected': {
    color: theme.palette.background.default,
    backgroundColor: theme.palette.secondary.main,
    fontWeight: theme.typography.fontWeightMedium
  },
  '&.Mui-focusVisible': {
    backgroundColor: theme.palette.secondary.main
  },
  [theme.breakpoints.down('sm')]: {
    fontSize: '12px',
    padding: '8px 4px',
    '&.MuiTab-root': {
      flex: 1,
      minWidth: 0
    }
  }
}));
// The routed content region; the section tabs point at it via aria-controls.
const MAIN_CONTENT_ID = 'main-content';

export default function MainLayout() {
  const theme = useTheme();
  const t = useTranslate();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));

  const { borderRadius, container, miniDrawer, menuOrientation } = useConfig();
  const { menuMaster, menuMasterLoading } = useGetMenuMaster();
  const drawerOpen = menuMaster?.isDashboardDrawerOpened;

  const tabs = [
    { label: t('nav.portfolio', 'Portfolio'), path: 'portfolio', iconPosition: 'top' },
    { label: t('nav.explore', 'Explore'), path: 'explore', iconPosition: 'top' },
    { label: t('nav.earn', 'Earn'), path: 'earn', iconPosition: 'top' },
    { label: t('nav.lend', 'Lend'), path: 'lend', iconPosition: 'top' },
    { label: t('nav.borrow', 'Borrow'), path: 'borrow', iconPosition: 'top' }
  ];

  const navigate = useNavigate();
  const location = useLocation();
  const currentTabIndex = tabs.findIndex((tab) => location.pathname.includes(tab.path));

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    handlerDrawerOpen(!miniDrawer);
  }, [miniDrawer]);

  useEffect(() => {
    downMD && handlerDrawerOpen(false);
  }, [downMD]);

  const isHorizontal = menuOrientation === MenuOrientation.HORIZONTAL && !downMD;

  if (menuMasterLoading) return <Loader />;

  return (
    <Box sx={{ display: 'flex' }}>
      {/* header */}
      <AppBar enableColorOnDark position="fixed" color="inherit" elevation={0} sx={{ bgcolor: 'background.default' }}>
        <Toolbar sx={{ p: isHorizontal ? 1.25 : 2 }}>
          <Header />
        </Toolbar>
      </AppBar>

      {/* main content */}
      <MainContentStyled {...{ borderRadius, menuOrientation, open: drawerOpen, marginTop: 80 }}>
        <Container
          maxWidth={'lg'}
          sx={{
            ...(!container && { px: { xs: 0 } }),
            minHeight: 'calc(100vh - 228px)',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* breadcrumb */}
          <Breadcrumbs />
          {/*<Outlet />*/}

          {/*<MainCard>*/}
          <MainCard>
            {/* Section switcher: wrapped in a real <nav> landmark so the sections of the app are
                discoverable, while MUI keeps the tab roles/selected state for the active section. */}
            <Box component="nav" aria-label={t('nav.sections', 'App sections')}>
              <AntTabs value={currentTabIndex === -1 ? false : currentTabIndex} centered>
                {tabs.map((tab, index) => (
                  <AntTab
                    wrapped={true}
                    key={tab.path}
                    label={tab.label}
                    aria-label={t('nav.sectionLabel', '{section} section', { section: tab.label })}
                    aria-controls={MAIN_CONTENT_ID}
                    onClick={() => {
                      const tabPath = `/${tab.path}`;
                      // click on the already-active tab
                      if (currentTabIndex === index) {
                        navigate(tabPath, { replace: true, state: { refresh: Date.now() } });
                      } else {
                        navigate(tabPath);
                      }
                    }}
                  />
                ))}
              </AntTabs>
            </Box>
            <Box component="main" id={MAIN_CONTENT_ID} sx={{ pt: 3 }}>
              <Outlet />
            </Box>
          </MainCard>
          {/*</MainCard>*/}
        </Container>
        {/* footer */}
        <Footer />
      </MainContentStyled>
    </Box>
  );
}
