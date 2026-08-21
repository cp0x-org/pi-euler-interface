import React, { FC } from 'react';
import { MarketInterface } from 'types/market';
import { MockActionForm } from 'components/MockActionForm';
import useTranslate from 'hooks/useTranslate';
import { MOCK_TOKEN_BALANCE } from 'mocks/positions';

interface SupplyTabProps {
  market: MarketInterface;
  marketId: string;
  onSuccess?: () => void;
  onBorrowAmountChange: (amount: bigint) => void;
  onCollateralAmountChange: (amount: bigint) => void;
}

const SupplyTab: FC<SupplyTabProps> = ({ market, onCollateralAmountChange }) => {
  const t = useTranslate();

  return (
    <MockActionForm
      title={t('market.tab.supplyLoan', 'Supply Loan')}
      subtitle={t('market.subtitle.supplyLoan', 'Supply Loan Token Amount:')}
      actionLabel={t('common.supply', 'Supply')}
      assetSymbol={market.loanAsset?.symbol || 'N/A'}
      assetDecimals={market.loanAsset?.decimals ?? 18}
      balance={MOCK_TOKEN_BALANCE}
      onAmountChange={onCollateralAmountChange}
    />
  );
};

export default SupplyTab;
