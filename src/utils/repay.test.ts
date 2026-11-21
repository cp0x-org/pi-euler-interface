import { describe, expect, it } from 'vitest';
import { maxUint256 } from 'viem';

import { getRepayAmounts, requiresRepayReview } from './repay';

describe('repay amounts', () => {
  it.each([true, false])('limits Max to the payer balance even for a debt ten times larger (other=%s)', (isOther) => {
    const amounts = getRepayAmounts(10_000n, 100_000n, 10_000n, isOther, 'balance');
    expect(amounts.maximum).toBe(10_000n);
    expect(amounts.assets).toBe(10_000n);
    expect(amounts.remainingDebt).toBe(90_000n);
    expect(amounts.approval).toBe(10_010n);
  });

  it('caps a fixed payment at the newly read debt after another payment', () => {
    expect(getRepayAmounts(200n, 65n, 90n, true).assets).toBe(65n);
    expect(getRepayAmounts(200n, 65n, 90n, true).approval).toBe(65n);
  });

  it('reserves the extra fraction only for approval, rounding it up by a token unit', () => {
    const amounts = getRepayAmounts(1001n, 1003n, 2000n, true, 'debt');
    expect(amounts.approval).toBe(1003n);
    expect(amounts.payment).toBe(1001n);
    expect(amounts.assets).toBe(1001n);
    expect(amounts.remainingDebt).toBe(2n);
  });

  it('buffers the live debt on own Max and caps the debit at the freshly available balance', () => {
    expect(getRepayAmounts(1000n, 1001n, 2000n, false, 'debt')).toMatchObject({ payment: 1001n, approval: 1003n, assets: maxUint256 });
    expect(getRepayAmounts(1000n, 1001n, 999n, false, 'debt')).toMatchObject({ payment: 999n, approval: 1000n, assets: 999n });
    expect(getRepayAmounts(1000n, 1001n, 2000n, false).approval).toBe(1000n);
  });

  it('leaves inclusion headroom for an own full Max without requiring a new buffered approval on every block', () => {
    const selected = getRepayAmounts(100_000n, 100_000n, 200_000n, false, 'debt');
    expect(selected.requiredAllowance).toBeGreaterThan(selected.payment);
    const later = getRepayAmounts(100_000n, 100_001n, 200_000n, false, 'debt');
    expect(later.requiredAllowance).toBeLessThanOrEqual(selected.approval);
    expect(getRepayAmounts(100_000n, 100_000n, 200_000n, true, 'debt').requiredAllowance).toBe(100_000n);
  });

  it('requires a second click only above one percent of the amount shown, in base units', () => {
    expect(requiresRepayReview(10000n, 10100n)).toBe(false);
    expect(requiresRepayReview(10000n, 10101n)).toBe(true);
    expect(requiresRepayReview(1n, 2n)).toBe(true);
    expect(requiresRepayReview(2000n, 1000n)).toBe(false);
  });

  it('preserves an own full Max through interest accrual, while keeping a balance-limited Max fixed', () => {
    expect(getRepayAmounts(1000n, 1001n, 2000n, false, 'debt').assets).toBe(maxUint256);
    expect(getRepayAmounts(1000n, 1001n, 1000n, false, 'debt').assets).toBe(1000n);
    expect(getRepayAmounts(1000n, 1001n, 2000n, false, 'balance').assets).toBe(1000n);
    expect(getRepayAmounts(1001n, 1001n, 2000n, false).assets).toBe(maxUint256);
  });
});
