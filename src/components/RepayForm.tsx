import { useEffect, useMemo, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Alert, Box, Button, CircularProgress, InputBase, Paper, Stack, Typography, useTheme } from '@mui/material';
import {
  Address,
  BaseError,
  ContractFunctionRevertedError,
  formatUnits,
  type Hash,
  parseUnits,
  type TransactionReceipt,
  toFunctionSelector
} from 'viem';
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi';

import { ERC20_ABI, simulateTokenApproval } from '@/contracts/erc4626';
import { EVAULT_ABI } from '@/contracts/evk';
import TransactionLink from 'components/TransactionLink';
import { getRepayAmounts, requiresRepayReview, type MaxSelection } from 'utils/repay';
import { TokenIcon } from 'components/TokenIcon';
import useTranslate from 'hooks/useTranslate';
import { formatAssetOutput, normalizePointAmount, shortenAddress } from 'utils/formatters';
import { dispatchError, dispatchSuccess } from 'utils/snackbar';

interface RepayFormProps {
  targetAccount: Address;
  isOther: boolean;
  chainId: number;
  liabilityVault: { address: Address; asset: { address: Address; symbol: string; decimals: number }; borrowApy: number };
  assetPriceUsd: number;
  tokenLogoUrl: string;
  onSuccess: (receipt: TransactionReceipt, message: string) => void | Promise<void>;
}

type Step = 'idle' | 'readingDebt' | 'resetting' | 'approving' | 'repaying' | 'confirming';

const REPAY_TOO_MUCH = toFunctionSelector('E_RepayTooMuch()');

function rawText(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
function inputFromRaw(value: bigint, decimals: number): string {
  return formatUnits(value, decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function parseRepayAmount(value: string, decimals: number): bigint {
  try {
    return parseUnits(normalizePointAmount(value || '0'), decimals);
  } catch {
    return 0n;
  }
}

export default function RepayForm({
  targetAccount,
  isOther,
  chainId,
  liabilityVault,
  assetPriceUsd,
  tokenLogoUrl,
  onSuccess
}: RepayFormProps) {
  const theme = useTheme();
  const t = useTranslate();
  const { address, chainId: connectedChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState('');
  const [maxSelection, setMaxSelection] = useState<MaxSelection>();
  const [step, setStep] = useState<Step>('idle');
  const [hash, setHash] = useState<Hash>();
  const [message, setMessage] = useState('');
  const [messageSeverity, setMessageSeverity] = useState<'success' | 'warning' | 'error'>('success');

  const vaultAddress = liabilityVault.address;
  const assetAddress = liabilityVault.asset.address;
  const decimals = liabilityVault.asset.decimals;
  const symbol = liabilityVault.asset.symbol;

  const reads = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          { address: assetAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId },
          { address: assetAddress, abi: ERC20_ABI, functionName: 'allowance', args: [address, vaultAddress], chainId }
        ]
      : [],
    query: { enabled: Boolean(address), refetchInterval: 15_000 }
  });
  const debtRead = useReadContract({
    address: vaultAddress,
    abi: EVAULT_ABI,
    functionName: 'debtOf',
    args: [targetAccount],
    chainId,
    query: { refetchInterval: 15_000 }
  });
  const debt = debtRead.data ?? 0n;
  const balance = (reads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance = (reads.data?.[1]?.result as bigint | undefined) ?? 0n;

  const amountRaw = useMemo(() => parseRepayAmount(amount, decimals), [amount, decimals]);
  const updateAmount = (value: string, selection?: MaxSelection) => {
    setAmount(value);
    setMaxSelection(selection);
  };

  const busy = step !== 'idle';
  const wrongNetwork = Boolean(address && connectedChainId !== chainId);
  const noDebt = debt === 0n;
  const quote = getRepayAmounts(amountRaw, debt, balance, isOther, maxSelection);
  const followsDebt = !isOther && maxSelection === 'debt';
  const displayedAmount = followsDebt ? inputFromRaw(quote.payment, decimals) : amount;
  // A lower live quote becomes the new reference. Background increases cannot acknowledge themselves.
  useEffect(() => {
    if (followsDebt && debtRead.isSuccess && reads.data?.[0]?.status === 'success' && quote.payment < amountRaw) {
      setAmount(inputFromRaw(quote.payment, decimals));
    }
  }, [followsDebt, debtRead.isSuccess, reads.data, quote.payment, amountRaw, decimals]);
  const repayFull = debt > 0n && quote.remainingDebt === 0n;
  const needsApprove = quote.requiredAllowance > allowance;
  const exceedsBalance = quote.payment > balance;
  const canSubmit = quote.payment > 0n && !exceedsBalance && !noDebt;

  const readRepayment = async () => {
    const [debtResult, wallet] = await Promise.all([debtRead.refetch(), reads.refetch()]);
    if (!debtResult.isSuccess) throw new Error(t('repay.debtCheckFailed', 'Could not read the current debt for this account.'));
    const liveBalance = wallet.data?.[0]?.result;
    const liveAllowance = wallet.data?.[1]?.result;
    if (!wallet.isSuccess || typeof liveBalance !== 'bigint' || typeof liveAllowance !== 'bigint') {
      throw new Error(t('form.rpcUnavailable', 'RPC client is not available'));
    }
    const liveQuote = getRepayAmounts(amountRaw, debtResult.data, liveBalance, isOther, maxSelection);
    return { ...liveQuote, debt: debtResult.data, balance: liveBalance, allowance: liveAllowance };
  };

  const showError = (error: unknown) => {
    const debtChanged =
      error instanceof BaseError &&
      error.walk(
        (cause) =>
          cause instanceof ContractFunctionRevertedError && (cause.data?.errorName === 'E_RepayTooMuch' || cause.raw === REPAY_TOO_MUCH)
      );
    const text = debtChanged
      ? t('repay.debtChanged', 'Debt changed, refresh and try again.')
      : error instanceof BaseError
        ? error.shortMessage
        : error instanceof Error
          ? error.message
          : t('form.txFailed', 'Transaction failed');
    setMessage(text);
    setMessageSeverity('error');
    dispatchError(text);
  };

  const selectMax = async () => {
    setStep('readingDebt');
    try {
      const fresh = await readRepayment();
      updateAmount(inputFromRaw(fresh.maximum, decimals), fresh.maximum === fresh.debt ? 'debt' : 'balance');
    } catch (error) {
      showError(error);
    } finally {
      setStep('idle');
    }
  };

  const wait = async (txHash: Hash, replay?: (blockNumber: bigint) => Promise<unknown>) => {
    if (!publicClient) throw new Error(t('form.rpcUnavailable', 'RPC client is not available'));
    setHash(txHash);
    setStep('confirming');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    if (receipt.status !== 'success') {
      // Receipts carry no revert data. Replay a failed repayment at its mined block to decode the vault error.
      if (replay) await replay(receipt.blockNumber);
      throw new Error(t('form.txReverted', 'Transaction reverted'));
    }
    return receipt;
  };

  const submit = async () => {
    if (!address) return openConnectModal?.();
    if (wrongNetwork) return switchChainAsync({ chainId });
    if (!publicClient || !canSubmit || busy) return;
    setMessage('');
    setMessageSeverity('success');
    setHash(undefined);
    try {
      setStep('readingDebt');
      const fresh = await readRepayment();
      if (followsDebt) {
        // Keep the amount the user last accepted as a guard even when polling has already updated the field.
        const previous = amountRaw < quote.payment ? amountRaw : quote.payment;
        updateAmount(inputFromRaw(fresh.payment, decimals), maxSelection);
        if (requiresRepayReview(previous, fresh.payment)) {
          setMessage(
            t(
              'repay.reviewIncrease',
              'The repayment amount increased by more than 1%. Review the updated amount and press the button again.'
            )
          );
          setMessageSeverity('warning');
          return;
        }
      }
      const requiresApproval = fresh.requiredAllowance > fresh.allowance;
      if (fresh.payment === 0n || fresh.payment > fresh.balance || requiresApproval !== needsApprove) return;

      if (requiresApproval) {
        const approve = async (limit: bigint) => {
          const approval = await simulateTokenApproval(publicClient, {
            account: address,
            token: assetAddress,
            spender: vaultAddress,
            amount: limit,
            chainId
          });
          if (!approval) throw new Error(t('form.approvalDeclined', 'The token declined the spending approval.'));
          await wait(await writeContractAsync(approval));
        };
        if (fresh.allowance > 0n) {
          setStep('resetting');
          await approve(0n);
        }
        setStep('approving');
        await approve(fresh.approval);
        setMessage(t('repay.approvalConfirmedRetry', 'Approval confirmed. Submit again to repay {symbol}.', { symbol }));
        dispatchSuccess(t('form.approvalConfirmed', '{symbol} approval confirmed', { symbol }));
        await Promise.all([reads.refetch(), debtRead.refetch()]);
        return;
      }

      setStep('repaying');
      const call = {
        account: address,
        address: vaultAddress,
        abi: EVAULT_ABI,
        functionName: 'repay',
        args: [fresh.assets, targetAccount]
      } as const;
      const repay = await publicClient.simulateContract(call);
      const receipt = await wait(await writeContractAsync(repay.request), (blockNumber) =>
        publicClient.simulateContract({ ...call, blockNumber })
      );
      const confirmed = t('repay.txConfirmed', 'Repay transaction confirmed');
      const confirmation = isOther
        ? confirmed
        : fresh.remainingDebt === 0n
          ? t('repay.repaidFull', 'Repaid the full {symbol} debt.', { symbol })
          : t('repay.repaidAmount', 'Repaid {amount} {symbol}.', { amount, symbol });
      dispatchSuccess(confirmed);
      setHash(undefined);
      updateAmount('');
      await Promise.all([onSuccess(receipt, confirmation), reads.refetch(), debtRead.refetch()]);
    } catch (error) {
      showError(error);
    } finally {
      setStep('idle');
    }
  };

  const buttonLabel = busy
    ? (
        {
          readingDebt: t('repay.readingDebt', 'Checking current debt...'),
          resetting: t('form.resettingAllowance', 'Resetting allowance...'),
          approving: t('form.approvingSymbol', 'Approving {symbol}...', { symbol }),
          repaying: t('repay.repayingSymbol', 'Repaying {symbol}...', { symbol }),
          confirming: t('form.confirmingTx', 'Confirming transaction...'),
          idle: ''
        } as Record<Step, string>
      )[step]
    : !address
      ? t('wallet.connectShort', 'Connect wallet')
      : wrongNetwork
        ? t('wallet.switchNetwork', 'Switch network')
        : needsApprove
          ? t('form.approveSymbol', 'Approve {symbol}', { symbol })
          : isOther
            ? t('repay.forAccount', 'Repay for {address}', { address: shortenAddress(targetAccount) })
            : repayFull
              ? t('repay.repayAllSymbol', 'Repay all {symbol}', { symbol })
              : t('repay.repaySymbol', 'Repay {symbol}', { symbol });

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h3">{t('common.repay', 'Repay')}</Typography>
        <Typography variant="h3" sx={{ color: theme.palette.warning.main }}>
          {liabilityVault.borrowApy.toFixed(2)}%
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ padding: 2, borderRadius: 1, borderColor: theme.palette.divider }}>
        <Typography variant="body2" color="text.secondary">
          {t('repay.amountLabel', 'Repay amount')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginY: 1 }}>
          <InputBase
            fullWidth
            value={displayedAmount}
            onChange={(event) => updateAmount(formatAssetOutput(event.target.value))}
            disabled={busy}
            readOnly={!address}
            placeholder="0.00"
            inputProps={{ inputMode: 'decimal', 'aria-label': t('repay.amountInputLabel', 'Amount of {symbol} to repay', { symbol }) }}
            sx={{ '& input': { fontSize: 32, fontWeight: 500, padding: 0 } }}
          />
          <TokenIcon symbol={symbol} logoUrl={tokenLogoUrl} avatarProps={{ sx: { width: 24, height: 24, fontSize: 9 } }} />
          <Typography variant="h4">{symbol}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography color="text.secondary">
            ${(Number(formatUnits(quote.payment, decimals)) * assetPriceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </Typography>
          <Typography color="text.secondary">
            {address ? rawText(quote.maximum, decimals) : '0'} {symbol}{' '}
            <Button
              size="small"
              onClick={selectMax}
              disabled={!address || quote.maximum === 0n || busy}
              aria-label={t('repay.useMax', 'Use maximum repayable {symbol}', { symbol })}
            >
              {t('common.max', 'Max')}
            </Button>
          </Typography>
        </Box>
      </Paper>

      <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1, padding: 2 }}>
        <Stack spacing={1.25}>
          <Row label={t('common.currentDebt', 'Current debt')} value={`${rawText(debt, decimals)} ${symbol}`} />
          <Row label={t('common.walletBalance', 'Wallet balance')} value={`${rawText(balance, decimals)} ${symbol}`} />
          <Row
            label={t('repay.remainingDebt', 'Remaining debt')}
            value={
              isOther && repayFull
                ? t('repay.approximateRemaining', '≈ 0 (interest accrued until the transaction is mined may remain)')
                : `${rawText(quote.remainingDebt, decimals)} ${symbol}`
            }
            valueColor={quote.remainingDebt === 0n ? theme.palette.success.main : undefined}
          />
        </Stack>
      </Box>

      {noDebt && address && <Alert severity="info">{t('repay.noDebt', 'This position has no outstanding debt to repay.')}</Alert>}
      {exceedsBalance && (
        <Alert severity="warning">{t('repay.exceedsBalance', 'Repay amount exceeds your {symbol} wallet balance.', { symbol })}</Alert>
      )}
      {message && <Alert severity={messageSeverity}>{message}</Alert>}
      {hash && <TransactionLink chainId={chainId} hash={hash} />}

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

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ textAlign: 'right', color: valueColor }}>{value}</Typography>
    </Box>
  );
}
