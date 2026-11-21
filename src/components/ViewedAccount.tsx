import { useState } from 'react';
import { Link as RouterLink, type To } from 'react-router-dom';
import { Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import type { Address } from 'viem';
import type useViewedAccount from 'hooks/useViewedAccount';
import { shortenAddress } from 'utils/formatters';
import { parseAccountAddress } from 'utils/viewedAccount';
import useTranslate from 'hooks/useTranslate';

export function AccountLookup({
  rawAccount,
  requestedAccount,
  invalidAccount,
  connected,
  setAccount
}: ReturnType<typeof useViewedAccount>) {
  const t = useTranslate();
  const [input, setInput] = useState(requestedAccount ?? rawAccount ?? '');
  const [invalid, setInvalid] = useState(invalidAccount);

  return (
    <Stack
      component="form"
      direction="row"
      useFlexGap
      flexWrap="wrap"
      alignItems="flex-start"
      spacing={1}
      sx={{ mb: 2 }}
      onSubmit={(event) => {
        event.preventDefault();
        const account = parseAccountAddress(input);
        setInvalid(!account);
        if (account) {
          setInput(account);
          setAccount(account);
        }
      }}
    >
      <TextField
        label={t('portfolio.viewAddress', 'View address')}
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          setInvalid(false);
        }}
        error={invalid}
        helperText={invalid && t('portfolio.invalidAddress', 'Enter a valid Ethereum address.')}
        autoComplete="off"
        size="small"
        sx={{ flex: { xs: '1 0 100%', sm: '1 1 22rem' }, maxWidth: 520, minWidth: 0 }}
      />
      <Button type="submit" variant="contained" color="secondary" disabled={!input.trim()}>
        {t('portfolio.viewAccount', 'View')}
      </Button>
      {connected && (
        <Button
          type="button"
          color="secondary"
          onClick={() => {
            setInput('');
            setInvalid(false);
            setAccount(null);
          }}
        >
          {t('portfolio.myWallet', 'My wallet')}
        </Button>
      )}
    </Stack>
  );
}

export function ViewedPositionBanner({
  account,
  connected,
  ownHref,
  subAccount
}: {
  account: Address;
  connected?: Address;
  ownHref: To;
  subAccount?: Address;
}) {
  const t = useTranslate();
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Typography fontWeight={600}>{t('position.viewedLabel', 'Position of')}</Typography>
        <Chip
          size="small"
          component={RouterLink}
          to={ownHref}
          clickable
          title={account}
          label={shortenAddress(account)}
          aria-label={t('position.returnToWallet', 'Return to my wallet from {address}', { address: account })}
        />
      </Stack>
      {/* Full addresses: a shortened prefix/suffix can be matched by a vanity address in a crafted link. */}
      <Typography variant="body2" sx={{ mt: 0.5, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
        {account}
      </Typography>
      {subAccount && (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
          {t('position.viewedSubAccount', '· sub-account {address}', { address: subAccount })}
        </Typography>
      )}
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {connected
          ? t('position.walletPays', 'Your wallet {wallet} pays. It can repay and add collateral. Only the owner can borrow or withdraw.', {
              wallet: shortenAddress(connected)
            })
          : t('position.connectToPay', 'Connect a wallet to repay or add collateral. Only the owner can borrow or withdraw.')}
      </Typography>
    </Alert>
  );
}
