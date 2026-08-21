import React, { FC } from 'react';
import { MarketInterface } from 'types/market';
import { MockActionForm } from 'components/MockActionForm';
import useTranslate from 'hooks/useTranslate';
import { MOCK_TOKEN_BALANCE } from 'mocks/positions';

interface BorrowTabProps {
  market: MarketInterface;
  accrualPosition?: unknown;
  onSuccess?: () => void;
  onBorrowAmountChange: (amount: bigint) => void;
  onCollateralAmountChange: (amount: bigint) => void;
}

const BorrowTab: FC<BorrowTabProps> = ({ market, onBorrowAmountChange }) => {
  const t = useTranslate();

  return (
    <MockActionForm
      title={t('common.borrow', 'Borrow')}
      subtitle={t('market.subtitle.borrowLoan', 'Borrow Loan Token Amount:')}
      actionLabel={t('common.borrow', 'Borrow')}
      assetSymbol={market.loanAsset?.symbol || 'N/A'}
      assetDecimals={market.loanAsset?.decimals ?? 18}
      balance={MOCK_TOKEN_BALANCE}
      onAmountChange={onBorrowAmountChange}
    />
  );
};

export default BorrowTab;
