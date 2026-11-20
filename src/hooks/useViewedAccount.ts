import { useLocation, useSearchParams } from 'react-router-dom';
import { Address, getAddress } from 'viem';
import { useAccount } from 'wagmi';
import { parseViewedAccount } from 'utils/viewedAccount';

export default function useViewedAccount() {
  const { address } = useAccount();
  const connected = address && getAddress(address);
  const [params, setParams] = useSearchParams();
  const { pathname, hash } = useLocation();
  const rawAccount = params.get('account');

  const ownParams = new URLSearchParams(params);
  ownParams.delete('account');
  ownParams.delete('sub');
  const ownHref = { pathname, search: ownParams.toString(), hash };

  const setAccount = (account: Address | null) => {
    const next = new URLSearchParams(params);
    if (account) next.set('account', getAddress(account));
    else next.delete('account');
    setParams(next);
  };

  return { ...parseViewedAccount(rawAccount, connected), connected, rawAccount, setAccount, ownHref };
}
