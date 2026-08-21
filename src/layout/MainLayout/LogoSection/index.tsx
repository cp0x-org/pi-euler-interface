import { Link as RouterLink } from 'react-router-dom';
import { ReactComponent as Cp0xLogo } from '@/assets/images/cp0x-logo.svg';
import { ReactComponent as EulerWordmark } from '@/assets/images/euler-wordmark.svg';
import eulerLogo from '@/assets/images/euler-logo-dark-bg-32.png';
// material-ui
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';

// project imports
import { DASHBOARD_PATH } from 'config';
import useTranslate from 'hooks/useTranslate';

// ==============================|| MAIN LOGO ||============================== //

export default function LogoSection() {
  const t = useTranslate();

  return (
    <Link
      component={RouterLink}
      to={DASHBOARD_PATH}
      aria-label={t('site.logoLabel', 'cp0x permissionless Euler interface — go to start page')}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        // gap: 1.5,
        textDecoration: 'none'
      }}
    >
      {/* The link already carries the name; the marks themselves are decorative. */}
      <Cp0xLogo aria-hidden="true" focusable="false" style={{ width: 50, height: 30 }} />
      <Box aria-hidden="true" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, marginTop: '2px' }}>
        <Box component="img" src={eulerLogo} alt="" sx={{ width: 16, height: 16, borderRadius: '50%' }} />
        <EulerWordmark focusable="false" style={{ width: 42, height: 18 }} />
      </Box>
    </Link>
  );
}
