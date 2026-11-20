import { Address, getAddress, isAddress } from 'viem';

export function parseAccountAddress(value: string): Address | undefined {
  const address = value.trim();
  return isAddress(address) ? getAddress(address) : undefined;
}

export function parseViewedAccount(value: string | null, connected?: Address) {
  const requestedAccount = value === null ? undefined : parseAccountAddress(value);
  return {
    account: value === null ? connected : requestedAccount,
    requestedAccount,
    invalidAccount: value !== null && !requestedAccount,
    isOther: !!requestedAccount && requestedAccount.toLowerCase() !== connected?.toLowerCase()
  };
}

export function withViewedAccount(href: string, account?: Address, tab?: 'repay' | 'add') {
  if (!account && !tab) return href;
  const [pathname, search] = href.split('?');
  const params = new URLSearchParams(search);
  if (account) params.set('account', account);
  if (tab) params.set('tab', tab);
  return `${pathname}?${params}`;
}

export function getPositionTarget(account?: Address, subAccount?: string): Address | undefined {
  return subAccount ? parseAccountAddress(subAccount) : account;
}
