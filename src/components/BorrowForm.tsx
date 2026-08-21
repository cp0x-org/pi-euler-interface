import { useMemo, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Alert, Box, Button, CircularProgress, InputBase, Link, Paper, Stack, Typography, useTheme } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Address, BaseError, Hex, encodeFunctionData, formatUnits, parseUnits, zeroAddress } from 'viem';
import { useAccount, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi';

import { ERC20_ABI } from '@/contracts/erc4626';
import { EVAULT_ABI, EVC_ABI } from '@/contracts/evk';
import { TokenIcon } from 'components/TokenIcon';
import useTranslate from 'hooks/useTranslate';
import { V3VaultDetail } from 'types/euler';
import { formatAssetOutput, normalizePointAmount } from 'utils/formatters';
import { dispatchError, dispatchSuccess } from 'utils/snackbar';

interface BorrowFormProps {
  chainId: number;
  collateralVault: Address;
  collateralAsset: { address: Address; symbol: string; decimals: number };
  collateralLogoUrl: string;
  collateralPriceUsd: number;
  liabilityVault: V3VaultDetail;
  borrowLogoUrl: string;
  borrowPriceUsd: number;
  borrowLtv: number;
  liquidationLtv: number;
  // Managing an existing position: hide the "Deposit collateral" field (collateral is added via a
  // separate tab) and base the health/LTV preview on the position's existing collateral + debt.
  borrowOnly?: boolean;
  existingCollateralUsd?: number;
  existingDebtUsd?: number;
  onSuccess: () => void;
}

type Step = 'idle' | 'resetting' | 'approving' | 'borrowing' | 'confirming';

interface BatchItem {
  targetContract: Address;
  onBehalfOfAccount: Address;
  value: bigint;
  data: Hex;
}

function rawText(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export default function BorrowForm({
  chainId,
  collateralVault,
  collateralAsset,
  collateralLogoUrl,
  collateralPriceUsd,
  liabilityVault,
  borrowLogoUrl,
  borrowPriceUsd,
  borrowLtv,
  liquidationLtv,
  borrowOnly = false,
  existingCollateralUsd,
  existingDebtUsd,
  onSuccess
}: BorrowFormProps) {
  const theme = useTheme();
  const t = useTranslate();
  const { address, chainId: connectedChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const [collateralInput, setCollateralInput] = useState('');
  const [borrowInput, setBorrowInput] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [hash, setHash] = useState<Address>();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  const borrowVault = liabilityVault.address as Address;

  const reads = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          { address: collateralAsset.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId },
          { address: collateralAsset.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, collateralVault], chainId },
          { address: borrowVault, abi: EVAULT_ABI, functionName: 'EVC', chainId },
          { address: borrowVault, abi: EVAULT_ABI, functionName: 'debtOf', args: [address], chainId }
        ]
      : [],
    query: { enabled: Boolean(address), refetchInterval: 15_000 }
  });
  const collateralBalance = (reads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance = (reads.data?.[1]?.result as bigint | undefined) ?? 0n;
  const evc = reads.data?.[2]?.result as Address | undefined;
  const currentDebt = (reads.data?.[3]?.result as bigint | undefined) ?? 0n;

  const collateralRaw = useMemo(() => {
    if (borrowOnly) return 0n;
    try {
      return parseUnits(normalizePointAmount(collateralInput || '0'), collateralAsset.decimals);
    } catch {
      return 0n;
    }
  }, [collateralInput, collateralAsset.decimals, borrowOnly]);
  const borrowRaw = useMemo(() => {
    try {
      return parseUnits(normalizePointAmount(borrowInput || '0'), liabilityVault.asset.decimals);
    } catch {
      return 0n;
    }
  }, [borrowInput, liabilityVault.asset.decimals]);

  const collateralNum = Number(collateralInput) || 0;
  const borrowNum = Number(borrowInput) || 0;
  const addedCollateralUsd = collateralNum * collateralPriceUsd;
  // In borrow-only mode the collateral is already deposited: base the preview on the position's
  // existing collateral and total debt (prior + newly borrowed).
  const collateralUsd = borrowOnly ? (existingCollateralUsd ?? 0) : addedCollateralUsd;
  const priorDebtUsd = borrowOnly ? (existingDebtUsd ?? 0) : 0;
  const borrowUsd = priorDebtUsd + borrowNum * borrowPriceUsd;
  const collateralAmountForCalc = borrowOnly
    ? collateralPriceUsd > 0
      ? (existingCollateralUsd ?? 0) / collateralPriceUsd
      : 0
    : collateralNum;
  const positionLtv = collateralUsd > 0 ? borrowUsd / collateralUsd : 0;
  const healthFactor = borrowUsd > 0 ? (collateralUsd * liquidationLtv) / borrowUsd : Infinity;
  const liqPrice = collateralAmountForCalc > 0 && borrowUsd > 0 ? borrowUsd / (collateralAmountForCalc * liquidationLtv) : 0;
  const maxBorrowUsd = collateralUsd * borrowLtv;
  const additionalCapacityUsd = Math.max(0, maxBorrowUsd - priorDebtUsd);

  const busy = step !== 'idle';
  const wrongNetwork = Boolean(address && connectedChainId !== chainId);
  const exceedsBalance = collateralRaw > collateralBalance;
  const overLtv = collateralUsd > 0 && borrowUsd > maxBorrowUsd + 1e-6;
  const needsApprove = collateralRaw > 0n && collateralRaw > allowance;
  const canSubmit = borrowRaw > 0n && !exceedsBalance && !overLtv;

  const healthColor =
    healthFactor >= 2 ? theme.palette.success.main : healthFactor >= 1.25 ? theme.palette.warning.main : theme.palette.error.main;

  const wait = async (txHash: Address) => {
    if (!publicClient) throw new Error(t('form.rpcUnavailable', 'RPC client is not available'));
    setHash(txHash);
    setStep('confirming');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    if (receipt.status !== 'success') throw new Error(t('form.txReverted', 'Transaction reverted'));
  };

  const submit = async () => {
    if (!address) return openConnectModal?.();
    if (wrongNetwork) return switchChainAsync({ chainId });
    if (!publicClient || !canSubmit || busy) return;
    if (!evc) {
      setMessage(t('borrowForm.evcUnresolved', 'Could not resolve the vault connector (EVC). Try again in a moment.'));
      setFailed(true);
      return;
    }
    setMessage('');
    setFailed(false);
    setHash(undefined);
    try {
      // Approve the collateral asset to the collateral vault before it can be pulled in the batch.
      if (needsApprove) {
        if (allowance > 0n) {
          setStep('resetting');
          const reset = await publicClient.simulateContract({
            account: address,
            address: collateralAsset.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [collateralVault, 0n]
          });
          await wait(await writeContractAsync(reset.request));
        }
        setStep('approving');
        const approval = await publicClient.simulateContract({
          account: address,
          address: collateralAsset.address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [collateralVault, collateralRaw]
        });
        await wait(await writeContractAsync(approval.request));
        setStep('idle');
        setMessage(
          t('borrowForm.approvalConfirmedRetry', 'Approval confirmed. Submit again to borrow {symbol}.', {
            symbol: liabilityVault.asset.symbol
          })
        );
        dispatchSuccess(t('form.approvalConfirmed', '{symbol} approval confirmed', { symbol: collateralAsset.symbol }));
        await reads.refetch();
        return;
      }

      // enable collateral + controller + (deposit) + borrow, deferred as one EVC batch.
      // Items that target the EVC itself (enable*) must carry onBehalfOfAccount = address(0); the
      // account is taken from the call arguments. External items (deposit/borrow) run on behalf of
      // the account. Getting this wrong reverts the batch with EVC_InvalidAddress (0x8133abd1).
      const items: BatchItem[] = [
        {
          targetContract: evc,
          onBehalfOfAccount: zeroAddress,
          value: 0n,
          data: encodeFunctionData({ abi: EVC_ABI, functionName: 'enableCollateral', args: [address, collateralVault] })
        },
        {
          targetContract: evc,
          onBehalfOfAccount: zeroAddress,
          value: 0n,
          data: encodeFunctionData({ abi: EVC_ABI, functionName: 'enableController', args: [address, borrowVault] })
        }
      ];
      if (collateralRaw > 0n) {
        items.push({
          targetContract: collateralVault,
          onBehalfOfAccount: address,
          value: 0n,
          data: encodeFunctionData({ abi: EVAULT_ABI, functionName: 'deposit', args: [collateralRaw, address] })
        });
      }
      items.push({
        targetContract: borrowVault,
        onBehalfOfAccount: address,
        value: 0n,
        data: encodeFunctionData({ abi: EVAULT_ABI, functionName: 'borrow', args: [borrowRaw, address] })
      });

      setStep('borrowing');
      const batch = await publicClient.simulateContract({
        account: address,
        address: evc,
        abi: EVC_ABI,
        functionName: 'batch',
        args: [items]
      });
      await wait(await writeContractAsync(batch.request));
      setMessage(t('borrowForm.borrowed', 'Borrowed {amount} {symbol}.', { amount: borrowInput, symbol: liabilityVault.asset.symbol }));
      dispatchSuccess(t('borrowForm.txConfirmed', 'Borrow transaction confirmed'));
      setCollateralInput('');
      setBorrowInput('');
      await reads.refetch();
      onSuccess();
    } catch (error) {
      const text =
        error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : t('form.txFailed', 'Transaction failed');
      setMessage(text);
      setFailed(true);
      dispatchError(text);
    } finally {
      setStep('idle');
    }
  };

  const buttonLabel = busy
    ? (
        {
          resetting: t('form.resettingAllowance', 'Resetting allowance...'),
          approving: t('form.approvingSymbol', 'Approving {symbol}...', { symbol: collateralAsset.symbol }),
          borrowing: t('borrowForm.borrowingSymbol', 'Borrowing {symbol}...', { symbol: liabilityVault.asset.symbol }),
          confirming: t('form.confirmingTx', 'Confirming transaction...'),
          idle: ''
        } as Record<Step, string>
      )[step]
    : !address
      ? t('wallet.connectShort', 'Connect wallet')
      : wrongNetwork
        ? t('wallet.switchNetwork', 'Switch network')
        : needsApprove
          ? t('form.approveSymbol', 'Approve {symbol}', { symbol: collateralAsset.symbol })
          : t('borrowForm.borrowSymbol', 'Borrow {symbol}', { symbol: liabilityVault.asset.symbol });

  return (
    <Stack spacing={2}>
      {!borrowOnly && (
        <AmountField
          label={t('borrowForm.depositCollateral', 'Deposit collateral')}
          symbol={collateralAsset.symbol}
          logoUrl={collateralLogoUrl}
          value={collateralInput}
          onChange={(value) => setCollateralInput(formatAssetOutput(value))}
          usd={addedCollateralUsd}
          disabled={busy}
          balanceText={address ? `${rawText(collateralBalance, collateralAsset.decimals)} ${collateralAsset.symbol}` : undefined}
          onMax={address ? () => setCollateralInput(formatUnits(collateralBalance, collateralAsset.decimals)) : undefined}
        />
      )}
      <AmountField
        label={t('common.borrow', 'Borrow')}
        symbol={liabilityVault.asset.symbol}
        logoUrl={borrowLogoUrl}
        value={borrowInput}
        onChange={(value) => setBorrowInput(formatAssetOutput(value))}
        usd={borrowNum * borrowPriceUsd}
        disabled={busy}
        helper={
          additionalCapacityUsd > 0
            ? t('borrowForm.maxApprox', 'Max ~${amount}', {
                amount: additionalCapacityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })
              })
            : undefined
        }
      />

      <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1, padding: 2 }}>
        <Stack spacing={1.25}>
          <PreviewRow label={t('common.loanToValue', 'Loan-to-value')} value={`${(positionLtv * 100).toFixed(2)}%`} />
          <PreviewRow
            label={t('common.healthFactor', 'Health factor')}
            value={Number.isFinite(healthFactor) ? healthFactor.toFixed(2) : '∞'}
            valueColor={healthColor}
          />
          <PreviewRow
            label={t('common.borrowApy', 'Borrow APY')}
            value={`${liabilityVault.borrowApy.toFixed(2)}%`}
            valueColor={theme.palette.warning.main}
          />
          <PreviewRow
            label={t('common.liquidationPrice', '{symbol} liquidation price', { symbol: collateralAsset.symbol })}
            value={liqPrice > 0 ? `$${liqPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : '—'}
          />
          {currentDebt > 0n && (
            <PreviewRow
              label={t('common.currentDebt', 'Current debt')}
              value={`${rawText(currentDebt, liabilityVault.asset.decimals)} ${liabilityVault.asset.symbol}`}
            />
          )}
        </Stack>
      </Box>

      {exceedsBalance && (
        <Alert severity="warning">
          {t('borrowForm.exceedsCollateralBalance', 'Deposit exceeds your {symbol} balance.', { symbol: collateralAsset.symbol })}
        </Alert>
      )}
      {overLtv && (
        <Alert severity="warning">
          {t('borrowForm.exceedsMaxLtv', 'Borrow amount exceeds the {ltv}% max LTV for this collateral.', {
            ltv: (borrowLtv * 100).toFixed(0)
          })}
        </Alert>
      )}
      {message && <Alert severity={failed ? 'error' : 'success'}>{message}</Alert>}
      {hash && chainId === 1 && (
        <Link
          href={`https://etherscan.io/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          aria-label={t('form.viewTxLabel', 'View transaction {hash} in the block explorer', {
            hash: `${hash.slice(0, 6)}…${hash.slice(-4)}`
          })}
        >
          {t('form.viewTx', 'View transaction')} <OpenInNewIcon sx={{ fontSize: 16, verticalAlign: 'middle' }} />
        </Link>
      )}

      <Button
        variant="contained"
        color="secondary"
        size="large"
        onClick={submit}
        disabled={busy || (Boolean(address) && !wrongNetwork && !canSubmit)}
        aria-busy={busy}
        sx={{ minHeight: 48, fontWeight: 600 }}
      >
        {busy && <CircularProgress size={18} color="inherit" sx={{ marginRight: 1 }} />}
        {buttonLabel}
      </Button>
    </Stack>
  );
}

function PreviewRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ textAlign: 'right', color: valueColor }}>{value}</Typography>
    </Box>
  );
}

function AmountField({
  label,
  symbol,
  logoUrl,
  value,
  onChange,
  usd,
  disabled,
  helper,
  balanceText,
  onMax
}: {
  label: string;
  symbol: string;
  logoUrl: string;
  value: string;
  onChange: (value: string) => void;
  usd: number;
  disabled?: boolean;
  helper?: string;
  balanceText?: string;
  onMax?: () => void;
}) {
  const theme = useTheme();
  const t = useTranslate();
  return (
    <Paper variant="outlined" sx={{ padding: 2, borderRadius: 1, borderColor: theme.palette.divider }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {helper && (
          <Typography variant="body2" color="text.secondary">
            {helper}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginY: 0.5 }}>
        <InputBase
          fullWidth
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
          disabled={disabled}
          inputProps={{ inputMode: 'decimal', 'aria-label': t('form.fieldAmountLabel', '{label} amount in {symbol}', { label, symbol }) }}
          sx={{ '& input': { fontSize: 28, fontWeight: 500, padding: 0 } }}
        />
        <TokenIcon symbol={symbol} logoUrl={logoUrl} avatarProps={{ sx: { width: 24, height: 24, fontSize: 9 } }} />
        <Typography variant="h4">{symbol}</Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          ${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </Typography>
        {balanceText && (
          <Typography variant="body2" color="text.secondary">
            {balanceText}
            {onMax && (
              <Button
                size="small"
                onClick={onMax}
                disabled={disabled}
                aria-label={t('form.useMax', 'Use maximum available {symbol}', { symbol })}
              >
                {t('common.max', 'Max')}
              </Button>
            )}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
