import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';

// material-ui
import { Box, Button, Paper, Stack, Typography, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

import useTranslate from 'hooks/useTranslate';

// ==============================|| ELEMENT ERROR - COMMON ||============================== //

/**
 * Route-level fallback, wired as `errorElement` on the root route so a render error shows the app's
 * own screen (with a way out) instead of React Router's stack-trace page.
 */
export default function ErrorBoundary() {
  const error = useRouteError();
  const theme = useTheme();
  const t = useTranslate();
  const navigate = useNavigate();

  let message = t('error.unexpected', 'Something went wrong while rendering this page.');
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) message = t('error.notFound', 'This page does not exist.');
    else if (error.status === 503) message = t('error.serviceDown', 'The data service is unavailable right now.');
    else message = t('error.withStatus', 'Request failed with status {status}.', { status: error.status });
  }

  const detail = error instanceof Error ? error.message : undefined;

  return (
    <Paper sx={{ padding: 3, border: `1px solid ${theme.palette.divider}`, borderRadius: 1, maxWidth: 640, margin: '0 auto' }}>
      <Typography variant="h3" sx={{ marginBottom: 1 }}>
        {t('error.title', 'Something went wrong')}
      </Typography>
      <Typography color="text.secondary">{message}</Typography>
      {detail && (
        <Box
          component="pre"
          sx={{
            marginTop: 2,
            padding: 1.5,
            borderRadius: 1,
            overflowX: 'auto',
            fontSize: '0.75rem',
            color: theme.palette.text.secondary,
            backgroundColor: theme.palette.background.default
          }}
        >
          {detail}
        </Box>
      )}
      <Stack direction="row" spacing={1.5} sx={{ marginTop: 2.5 }}>
        <Button variant="contained" color="secondary" startIcon={<RefreshIcon />} onClick={() => window.location.reload()}>
          {t('error.reload', 'Reload')}
        </Button>
        <Button variant="outlined" color="secondary" onClick={() => navigate('/explore')}>
          {t('error.backToExplore', 'Back to Explore')}
        </Button>
      </Stack>
    </Paper>
  );
}
