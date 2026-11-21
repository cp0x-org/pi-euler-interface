import { maxUint256 } from 'viem';

export type MaxSelection = 'debt' | 'balance';

export const withApprovalBuffer = (amount: bigint) => amount + (amount + 999n) / 1000n;

export const requiresRepayReview = (shown: bigint, fresh: bigint) => fresh * 100n > shown * 101n;

export function getRepayAmounts(entered: bigint, debt: bigint, balance: bigint, isOther: boolean, max?: MaxSelection) {
  const maximum = balance < debt ? balance : debt;
  // Only the owner's full Max follows the live debt. A foreign payment always keeps its entered cap.
  const limit = !isOther && max === 'debt' ? maximum : entered;
  const payment = limit < debt ? limit : debt;
  const full = debt > 0n && payment === debt && !isOther;

  return {
    maximum,
    payment,
    assets: full ? maxUint256 : payment,
    // A full Max can accrue between simulation and inclusion. Check 1 bp, grant 10 bp, as on Morpho.
    requiredAllowance: full && max ? payment + (payment + 9999n) / 10000n : payment,
    approval: max ? withApprovalBuffer(payment) : payment,
    remainingDebt: debt - payment
  };
}
