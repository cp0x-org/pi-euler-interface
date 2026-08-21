import React, { FC } from 'react';
import { MarketInterface } from 'types/market';
import { MockActionForm } from 'components/MockActionForm';
import useTranslate from 'hooks/useTranslate';
import { MOCK_TOKEN_BALANCE } from 'mocks/positions';

interface WithdrawCollateralTabProps {
  market: MarketInterface;
  marketId: string;
  accrualPosition?: unknown;
  onSuccess?: () => void;
  onBorrowAmountChange: (amount: bigint) => void;
  onCollateralAmountChange: (amount: bigint) => void;
}

const WithdrawCollateralTab: FC<WithdrawCollateralTabProps> = ({ market, onCollateralAmountChange }) => {
  const t = useTranslate();

  return (
    <MockActionForm
      title={t('market.tab.withdrawCollateral', 'Withdraw Collateral')}
      subtitle={t('market.subtitle.withdrawCollateral', 'Withdraw Collateral Token Amount:')}
      actionLabel={t('market.tab.withdrawCollateral', 'Withdraw Collateral')}
      assetSymbol={market.collateralAsset?.symbol || 'N/A'}
      assetDecimals={market.collateralAsset?.decimals ?? 18}
      balance={MOCK_TOKEN_BALANCE}
      onAmountChange={(amount) => onCollateralAmountChange(-amount)}
    />
  );
};

export default WithdrawCollateralTab;
