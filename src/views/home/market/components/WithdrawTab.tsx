import React, { FC } from 'react';
import { MarketInterface } from 'types/market';
import { MockActionForm } from 'components/MockActionForm';
import useTranslate from 'hooks/useTranslate';
import { MOCK_TOKEN_BALANCE } from 'mocks/positions';

interface WithdrawTabProps {
  market: MarketInterface;
  marketId: string;
  accrualPosition?: unknown;
  sdkMarket?: unknown;
  onSuccess?: () => void;
  onBorrowAmountChange: (amount: bigint) => void;
  onLoanAmountChange: (amount: bigint) => void;
}

const WithdrawTab: FC<WithdrawTabProps> = ({ market, onLoanAmountChange }) => {
  const t = useTranslate();

  return (
    <MockActionForm
      title={t('common.withdraw', 'Withdraw')}
      subtitle={t('market.subtitle.withdrawLoan', 'Withdraw Loan Token Amount:')}
      actionLabel={t('common.withdraw', 'Withdraw')}
      assetSymbol={market.loanAsset?.symbol || 'N/A'}
      assetDecimals={market.loanAsset?.decimals ?? 18}
      balance={MOCK_TOKEN_BALANCE}
      onAmountChange={(amount) => onLoanAmountChange(-amount)}
    />
  );
};

export default WithdrawTab;
