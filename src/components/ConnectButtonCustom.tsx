import { ConnectButton } from '@rainbow-me/rainbowkit';
import { styled } from '@mui/material/styles';
import Box from '@mui/material/Box';
import { useAccount } from 'wagmi';
import '@rainbow-me/rainbowkit/styles.css';

import VisuallyHidden from 'components/VisuallyHidden';
import { getRuntimeConfig } from '@/appconfig/runtime';
import useTranslate from 'hooks/useTranslate';
import { getChainName } from 'utils/chains';
// Styled wrapper for the ConnectButton
const StyledConnectButtonWrapper = styled(Box)(({ theme }) => ({
  '& button': {
    fontFamily: theme.typography.fontFamily,
    fontWeight: 500,
    borderRadius: `${theme.shape.borderRadius}px`,
    transition: 'all 0.2s ease-in-out'
  }
}));

interface ConnectButtonCustomProps {
  showBalance?: boolean;
  chainStatus?: 'full' | 'icon' | 'name' | 'none';
  accountStatus?: 'full' | 'avatar' | 'address' | 'none';
  label?: string;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// RainbowKit renders the wallet/network state graphically (and, with chainStatus="icon", the
// selected network is an icon only). This mirrors that state as text for screen readers and
// automation, without rendering anything visible.
function useWalletStatusText(): string {
  const { address, chainId, isConnecting, isReconnecting } = useAccount();
  const { chains } = getRuntimeConfig();
  const t = useTranslate();

  if (isConnecting || isReconnecting) return t('wallet.connecting', 'Connecting wallet');
  if (!address) return t('wallet.notConnected', 'Wallet not connected');

  const supported = chains.some((chain) => chain.chainId === chainId);
  const network = chainId ? getChainName(chainId) : t('common.unknownNetwork', 'an unknown network');
  return supported
    ? t('wallet.connectedOn', 'Wallet connected: {address} on {network}', { address: shortAddress(address), network })
    : t('wallet.connectedUnsupported', 'Wallet connected: {address} on {network}, which is not supported — switch network', {
        address: shortAddress(address),
        network
      });
}

const ConnectButtonCustom = ({ showBalance = false, chainStatus = 'icon', accountStatus = 'full', label }: ConnectButtonCustomProps) => {
  const t = useTranslate();
  const statusText = useWalletStatusText();

  return (
    <StyledConnectButtonWrapper>
      <VisuallyHidden role="status" aria-live="polite" aria-atomic>
        {statusText}
      </VisuallyHidden>
      <ConnectButton chainStatus={chainStatus} showBalance={showBalance} label={label ?? t('wallet.connect', 'Connect Wallet')} />
    </StyledConnectButtonWrapper>
  );
};

export default ConnectButtonCustom;
