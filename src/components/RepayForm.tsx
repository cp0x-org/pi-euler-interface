import { useMemo, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Alert, Box, Button, CircularProgress, InputBase, Link, Paper, Stack, Typography, useTheme } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Address, BaseError, formatUnits, maxUint256, parseUnits } from 'viem';
import { useAccount, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi';

import { ERC20_ABI } from '@/contracts/erc4626';
import { EVAULT_ABI } from '@/contracts/evk';
import { TokenIcon } from 'components/TokenIcon';
import useTranslate from 'hooks/useTranslate';
import { formatAssetOutput, normalizePointAmount } from 'utils/formatters';
import { dispatchError, dispatchSuccess } from 'utils/snackbar';

interface RepayFormProps {
  chainId: number;
  liabilityVault: { address: Address; asset: { address: Address; symbol: string; decimals: number }; borrowApy: number };
  assetPriceUsd: number;
  tokenLogoUrl: string;
  onSuccess: () => void;
}

type Step = 'idle' | 'resetting' | 'approving' | 'repaying' | 'confirming';

function rawText(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
function inputFromRaw(value: bigint, decimals: number): string {
  return formatUnits(value, decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}
function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export default function RepayForm({ chainId, liabilityVault, assetPriceUsd, tokenLogoUrl, onSuccess }: RepayFormProps) {
  const theme = useTheme();
  const t = useTranslate();
  const { address, chainId: connectedChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [hash, setHash] = useState<Address>();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  const vaultAddress = liabilityVault.address;
  const assetAddress = liabilityVault.asset.address;
  const decimals = liabilityVault.asset.decimals;
  const symbol = liabilityVault.asset.symbol;

  const reads = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          { address: assetAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId },
          { address: assetAddress, abi: ERC20_ABI, functionName: 'allowance', args: [address, vaultAddress], chainId },
          { address: vaultAddress, abi: EVAULT_ABI, functionName: 'debtOf', args: [address], chainId }
        ]
      : [],
    query: { enabled: Boolean(address), refetchInterval: 15_000 }
  });
  const balance = (reads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance = (reads.data?.[1]?.result as bigint | undefined) ?? 0n;
  const debt = (reads.data?.[2]?.result as bigint | undefined) ?? 0n;
  const maxRepayable = minBigInt(debt, balance);

  const amountRaw = useMemo(() => {
    try {
      return parseUnits(normalizePointAmount(amount || '0'), decimals);
    } catch {
      return 0n;
    }
  }, [amount, decimals]);

  const busy = step !== 'idle';
  const wrongNetwork = Boolean(address && connectedChainId !== chainId);
  const exceedsBalance = amountRaw > balance;
  const noDebt = debt === 0n;
  // Repaying at least the full debt closes it out — use type(uint256).max so the vault settles the
  // exact remaining debt with no dust left behind.
  const repayFull = debt > 0n && amountRaw >= debt;
  const approveAmount = repayFull ? debt : amountRaw;
  const needsApprove = approveAmount > 0n && approveAmount > allowance;
  const remainingDebt = repayFull ? 0n : debt > amountRaw ? debt - amountRaw : 0n;
  const canSubmit = amountRaw > 0n && !exceedsBalance && !noDebt;

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
    setMessage('');
    setFailed(false);
    setHash(undefined);
    try {
      if (needsApprove) {
        if (allowance > 0n) {
          setStep('resetting');
          const reset = await publicClient.simulateContract({
            account: address,
            address: assetAddress,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [vaultAddress, 0n]
          });
          await wait(await writeContractAsync(reset.request));
        }
        setStep('approving');
        const approval = await publicClient.simulateContract({
          account: address,
          address: assetAddress,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [vaultAddress, approveAmount]
        });
        await wait(await writeContractAsync(approval.request));
        setStep('idle');
        setMessage(t('repay.approvalConfirmedRetry', 'Approval confirmed. Submit again to repay {symbol}.', { symbol }));
        dispatchSuccess(t('form.approvalConfirmed', '{symbol} approval confirmed', { symbol }));
        await reads.refetch();
        return;
      }

      setStep('repaying');
      const repay = await publicClient.simulateContract({
        account: address,
        address: vaultAddress,
        abi: EVAULT_ABI,
        functionName: 'repay',
        args: [repayFull ? maxUint256 : amountRaw, address]
      });
      await wait(await writeContractAsync(repay.request));
      setMessage(
        repayFull
          ? t('repay.repaidFull', 'Repaid the full {symbol} debt.', { symbol })
          : t('repay.repaidAmount', 'Repaid {amount} {symbol}.', { amount, symbol })
      );
      dispatchSuccess(t('repay.txConfirmed', 'Repay transaction confirmed'));
      setAmount('');
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
            value={amount}
            onChange={(event) => setAmount(formatAssetOutput(event.target.value))}
            placeholder="0.00"
            disabled={busy}
            inputProps={{ inputMode: 'decimal', 'aria-label': t('repay.amountInputLabel', 'Amount of {symbol} to repay', { symbol }) }}
            sx={{ '& input': { fontSize: 32, fontWeight: 500, padding: 0 } }}
          />
          <TokenIcon symbol={symbol} logoUrl={tokenLogoUrl} avatarProps={{ sx: { width: 24, height: 24, fontSize: 9 } }} />
          <Typography variant="h4">{symbol}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography color="text.secondary">
            ${(Number(normalizePointAmount(amount || '0')) * assetPriceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </Typography>
          <Typography color="text.secondary">
            {address ? rawText(maxRepayable, decimals) : '0'} {symbol}{' '}
            <Button
              size="small"
              onClick={() => setAmount(inputFromRaw(maxRepayable, decimals))}
              disabled={!address || maxRepayable === 0n || busy}
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
            value={`${rawText(remainingDebt, decimals)} ${symbol}`}
            valueColor={remainingDebt === 0n ? theme.palette.success.main : undefined}
          />
        </Stack>
      </Box>

      {noDebt && address && <Alert severity="info">{t('repay.noDebt', 'This position has no outstanding debt to repay.')}</Alert>}
      {exceedsBalance && (
        <Alert severity="warning">{t('repay.exceedsBalance', 'Repay amount exceeds your {symbol} wallet balance.', { symbol })}</Alert>
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

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ textAlign: 'right', color: valueColor }}>{value}</Typography>
    </Box>
  );
}
