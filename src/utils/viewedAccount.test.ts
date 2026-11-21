import { describe, expect, it } from 'vitest';

import { getPositionTarget, parseViewedAccount } from './viewedAccount';

const owner = '0x5a3F8E21c0b74D9a2e6f10C4B8D3a7E5f2c191c2';
const wallet = '0x0000000000000000000000000000000000000001';
const ownerSub = '0x5a3f8e21c0b74d9a2e6f10c4b8d3a7e5f2c191c3';
const walletSub = '0x0000000000000000000000000000000000000002';

describe('parseViewedAccount', () => {
  it('uses the connected wallet if the query is absent', () => {
    expect(parseViewedAccount(null, wallet)).toEqual({
      account: wallet,
      requestedAccount: undefined,
      invalidAccount: false,
      isOther: false
    });
  });

  it('views a valid address with no connected wallet and returns its checksum', () => {
    expect(parseViewedAccount(owner.toLowerCase(), undefined)).toEqual({
      account: owner,
      requestedAccount: owner,
      invalidAccount: false,
      isOther: true
    });
    expect(parseViewedAccount(owner, undefined).account).toBe(owner);
  });

  it('returns no portfolio account when an invalid address is supplied with a wallet connected', () => {
    for (const value of ['0x1234', '', owner.replace('F8', 'f8')]) {
      expect(parseViewedAccount(value, wallet)).toEqual({
        account: undefined,
        requestedAccount: undefined,
        invalidAccount: true,
        isOther: false
      });
    }
  });

  it('compares the requested and connected addresses case-insensitively', () => {
    expect(parseViewedAccount(owner, `0x${owner.slice(2).toLowerCase()}`).isOther).toBe(false);
    expect(parseViewedAccount(owner, wallet).isOther).toBe(true);
  });
});

describe('getPositionTarget', () => {
  it('uses the own main account when the position has no sub-account', () => {
    expect(getPositionTarget(wallet)).toBe(wallet);
    expect(getPositionTarget(wallet, wallet)).toBe(wallet);
  });

  it('uses the position sub-account for the connected owner', () => {
    expect(getPositionTarget(wallet, walletSub)).toBe(walletSub);
  });

  it('returns no target for a non-empty malformed sub-account, even with a valid parent', () => {
    for (const invalid of ['0x1234', owner.replace('F8', 'f8')]) {
      expect(getPositionTarget(wallet, invalid)).toBeUndefined();
    }
  });

  it('uses the other owner’s position sub-account or their main address', () => {
    expect(getPositionTarget(owner, ownerSub)?.toLowerCase()).toBe(ownerSub);
    expect(getPositionTarget(owner)).toBe(owner);
  });
});
