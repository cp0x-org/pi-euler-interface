import { useEffect, useMemo, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Alert, Box, Button, CircularProgress, InputBase, Link, Paper, Stack, Typography, useTheme } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Address, BaseError, formatUnits, parseUnits } from 'viem';
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi';

import { ERC20_ABI, ERC4626_ABI } from '@/contracts/erc4626';
import { TokenIcon } from 'components/TokenIcon';
import useTranslate from 'hooks/useTranslate';
import { EulerEarnVault } from 'types/euler';
import { formatAssetOutput, normalizePointAmount } from 'utils/formatters';
import { dispatchError, dispatchSuccess } from 'utils/snackbar';

export type EarnActionMode = 'supply' | 'withdraw';

interface EarnVaultActionFormProps {
  mode: EarnActionMode;
  vault: EulerEarnVault;
  chainId: number;
  assetPriceUsd: number;
  tokenLogoUrl: string;
  onSuccess: () => void;
}

type TransactionStep = 'idle' | 'resetting' | 'approving' | 'supplying' | 'withdrawing' | 'confirming';

function formatRawAmount(value: bigint, decimals: number, maximumFractionDigits = 6): string {
  const amount = Number(formatUnits(value, decimals));
  return amount.toLocaleString('en-US', { maximumFractionDigits });
}

function inputFromRaw(value: bigint, decimals: number): string {
  return formatUnits(value, decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function transactionError(error: unknown, fallback: string): string {
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : fallback;
}

export default function EarnVaultActionForm({ mode, vault, chainId, assetPriceUsd, tokenLogoUrl, onSuccess }: EarnVaultActionFormProps) {
  const theme = useTheme();
  const t = useTranslate();
  const { address, chainId: connectedChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const [inputAmount, setInputAmount] = useState('');
  const [step, setStep] = useState<TransactionStep>('idle');
  const [transactionHash, setTransactionHash] = useState<Address>();
  const [transactionMessage, setTransactionMessage] = useState('');
  const [transactionFailed, setTransactionFailed] = useState(false);

  const vaultAddress = vault.address as Address;
  const assetAddress = vault.asset.address as Address;
  const accountAddress = address as Address | undefined;

  useEffect(() => {
    setInputAmount('');
    setTransactionHash(undefined);
    setTransactionMessage('');
    setTransactionFailed(false);
  }, [mode]);

  const accountReads = useReadContracts({
    allowFailure: true,
    contracts: accountAddress
      ? [
          { address: assetAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [accountAddress], chainId },
          { address: assetAddress, abi: ERC20_ABI, functionName: 'allowance', args: [accountAddress, vaultAddress], chainId },
          { address: vaultAddress, abi: ERC4626_ABI, functionName: 'balanceOf', args: [accountAddress], chainId },
          { address: vaultAddress, abi: ERC4626_ABI, functionName: 'maxDeposit', args: [accountAddress], chainId },
          { address: vaultAddress, abi: ERC4626_ABI, functionName: 'maxWithdraw', args: [accountAddress], chainId },
          { address: vaultAddress, abi: ERC4626_ABI, functionName: 'maxRedeem', args: [accountAddress], chainId }
        ]
      : [],
    query: { enabled: Boolean(accountAddress), refetchInterval: 15_000 }
  });

  const assetBalance = (accountReads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance = (accountReads.data?.[1]?.result as bigint | undefined) ?? 0n;
  const shareBalance = (accountReads.data?.[2]?.result as bigint | undefined) ?? 0n;
  const maxDeposit = accountReads.data?.[3]?.result as bigint | undefined;
  const maxWithdraw = (accountReads.data?.[4]?.result as bigint | undefined) ?? 0n;
  const maxRedeem = (accountReads.data?.[5]?.result as bigint | undefined) ?? 0n;
  const supplyLimit = maxDeposit === undefined ? assetBalance : minBigInt(assetBalance, maxDeposit);
  const availableAmount = mode === 'supply' ? supplyLimit : maxWithdraw;

  const amountRaw = useMemo(() => {
    try {
      return parseUnits(normalizePointAmount(inputAmount || '0'), vault.asset.decimals);
    } catch {
      return 0n;
    }
  }, [inputAmount, vault.asset.decimals]);

  const depositPreview = useReadContract({
    address: vaultAddress,
    abi: ERC4626_ABI,
    functionName: 'previewDeposit',
    args: [amountRaw],
    chainId,
    query: { enabled: mode === 'supply' && amountRaw > 0n }
  });
  const withdrawPreview = useReadContract({
    address: vaultAddress,
    abi: ERC4626_ABI,
    functionName: 'previewWithdraw',
    args: [amountRaw],
    chainId,
    query: { enabled: mode === 'withdraw' && amountRaw > 0n }
  });
  const shareDecimalsQuery = useReadContract({
    address: vaultAddress,
    abi: ERC4626_ABI,
    functionName: 'decimals',
    chainId
  });

  const previewShares = mode === 'supply' ? depositPreview.data : withdrawPreview.data;
  const shareDecimals = Number(shareDecimalsQuery.data ?? vault.asset.decimals);
  const amountNumber = Number(normalizePointAmount(inputAmount || '0')) || 0;
  const amountUsd = amountNumber * assetPriceUsd;
  const amountExceedsBalance = amountRaw > availableAmount;
  const approvalRequired = mode === 'supply' && amountRaw > allowance;
  const busy = step !== 'idle';
  const wrongNetwork = Boolean(accountAddress && connectedChainId !== chainId);

  const handleAmountChange = (value: string) => {
    setInputAmount(formatAssetOutput(value));
    setTransactionHash(undefined);
    setTransactionMessage('');
    setTransactionFailed(false);
  };

  const handleMax = () => {
    setInputAmount(inputFromRaw(availableAmount, vault.asset.decimals));
    setTransactionHash(undefined);
    setTransactionMessage('');
    setTransactionFailed(false);
  };

  const waitForReceipt = async (hash: Address) => {
    if (!publicClient) throw new Error(t('form.rpcUnavailableNetwork', 'RPC client is not available for this network'));
    setTransactionHash(hash);
    setStep('confirming');
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== 'success') throw new Error(t('form.txReverted', 'Transaction reverted'));
  };

  const approve = async (amount: bigint) => {
    if (!accountAddress || !publicClient) return;

    if (allowance > 0n) {
      setStep('resetting');
      const reset = await publicClient.simulateContract({
        account: accountAddress,
        address: assetAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vaultAddress, 0n]
      });
      await waitForReceipt(await writeContractAsync(reset.request));
    }

    setStep('approving');
    const approval = await publicClient.simulateContract({
      account: accountAddress,
      address: assetAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddress, amount]
    });
    await waitForReceipt(await writeContractAsync(approval.request));
    await accountReads.refetch();
    setTransactionMessage(
      t('earnForm.approvalConfirmedRetry', '{symbol} spending approved. Submit again to supply.', { symbol: vault.asset.symbol })
    );
    dispatchSuccess(t('form.approvalConfirmed', '{symbol} approval confirmed', { symbol: vault.asset.symbol }));
  };

  const supply = async () => {
    if (!accountAddress || !publicClient) return;
    setStep('supplying');
    const simulation = await publicClient.simulateContract({
      account: accountAddress,
      address: vaultAddress,
      abi: ERC4626_ABI,
      functionName: 'deposit',
      args: [amountRaw, accountAddress]
    });
    await waitForReceipt(await writeContractAsync(simulation.request));
    setTransactionMessage(t('earnForm.supplied', 'Supplied {amount} {symbol}.', { amount: inputAmount, symbol: vault.asset.symbol }));
    dispatchSuccess(t('earnForm.supplyTxConfirmed', 'Supply transaction confirmed'));
  };

  const withdraw = async () => {
    if (!accountAddress || !publicClient) return;
    setStep('withdrawing');
    const simulation = await publicClient.simulateContract({
      account: accountAddress,
      address: vaultAddress,
      abi: ERC4626_ABI,
      functionName: 'withdraw',
      args: [amountRaw, accountAddress, accountAddress]
    });
    await waitForReceipt(await writeContractAsync(simulation.request));
    setTransactionMessage(t('earnForm.withdrew', 'Withdrew {amount} {symbol}.', { amount: inputAmount, symbol: vault.asset.symbol }));
    dispatchSuccess(t('earnForm.withdrawTxConfirmed', 'Withdraw transaction confirmed'));
  };

  const handleSubmit = async () => {
    if (!accountAddress) {
      openConnectModal?.();
      return;
    }
    if (wrongNetwork) {
      await switchChainAsync({ chainId });
      return;
    }
    if (amountRaw <= 0n || amountExceedsBalance || busy) return;

    setTransactionHash(undefined);
    setTransactionMessage('');
    setTransactionFailed(false);
    try {
      if (approvalRequired) {
        await approve(amountRaw);
      } else if (mode === 'supply') {
        await supply();
        setInputAmount('');
        await accountReads.refetch();
        onSuccess();
      } else {
        await withdraw();
        setInputAmount('');
        await accountReads.refetch();
        onSuccess();
      }
    } catch (error) {
      const message = transactionError(error, t('form.txFailed', 'Transaction failed'));
      setTransactionMessage(message);
      setTransactionFailed(true);
      dispatchError(message);
    } finally {
      setStep('idle');
    }
  };

  const buttonLabel = (() => {
    if (busy) {
      const labels: Record<Exclude<TransactionStep, 'idle'>, string> = {
        resetting: t('form.resettingAllowance', 'Resetting allowance...'),
        approving: t('form.approvingSymbol', 'Approving {symbol}...', { symbol: vault.asset.symbol }),
        supplying: t('earnForm.supplyingSymbol', 'Supplying {symbol}...', { symbol: vault.asset.symbol }),
        withdrawing: t('earnForm.withdrawingSymbol', 'Withdrawing {symbol}...', { symbol: vault.asset.symbol }),
        confirming: t('form.confirmingTx', 'Confirming transaction...')
      };
      return labels[step as Exclude<TransactionStep, 'idle'>];
    }
    if (!accountAddress) return t('wallet.connectShort', 'Connect wallet');
    if (wrongNetwork) return t('wallet.switchNetwork', 'Switch network');
    if (approvalRequired) return t('form.approveSymbol', 'Approve {symbol}', { symbol: vault.asset.symbol });
    return mode === 'supply'
      ? t('earnForm.supplySymbol', 'Supply {symbol}', { symbol: vault.asset.symbol })
      : t('earnForm.withdrawSymbol', 'Withdraw {symbol}', { symbol: vault.asset.symbol });
  })();

  const buttonDisabled = busy || (Boolean(accountAddress) && !wrongNetwork && (amountRaw <= 0n || amountExceedsBalance));
  const explorerUrl = chainId === 1 && transactionHash ? `https://etherscan.io/tx/${transactionHash}` : undefined;

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h3">{mode === 'supply' ? t('common.supplyApy', 'Supply APY') : t('common.withdraw', 'Withdraw')}</Typography>
        <Typography variant="h3">{mode === 'supply' && vault.supplyApy != null ? `${vault.supplyApy.toFixed(2)}%` : ''}</Typography>
      </Box>

      <Paper variant="outlined" sx={{ padding: 2, borderRadius: 1, borderColor: theme.palette.divider }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {mode === 'supply' ? t('earnForm.supplyAmount', 'Supply amount') : t('earnForm.withdrawAmount', 'Withdraw amount')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginY: 1 }}>
          <InputBase
            fullWidth
            value={inputAmount}
            onChange={(event) => handleAmountChange(event.target.value)}
            placeholder="0.00"
            disabled={busy}
            inputProps={{
              inputMode: 'decimal',
              'aria-label':
                mode === 'supply'
                  ? t('earnForm.supplyAmountInputLabel', 'Amount of {symbol} to supply', { symbol: vault.asset.symbol })
                  : t('earnForm.withdrawAmountInputLabel', 'Amount of {symbol} to withdraw', { symbol: vault.asset.symbol })
            }}
            sx={{ '& input': { fontSize: 32, fontWeight: 500, padding: 0 } }}
          />
          <TokenIcon symbol={vault.asset.symbol} logoUrl={tokenLogoUrl} avatarProps={{ sx: { width: 24, height: 24, fontSize: 9 } }} />
          <Typography variant="h4">{vault.asset.symbol}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            ${amountUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {accountAddress ? formatRawAmount(availableAmount, vault.asset.decimals) : '0'} {vault.asset.symbol}
            </Typography>
            <Button
              size="small"
              onClick={handleMax}
              disabled={!accountAddress || availableAmount === 0n || busy}
              aria-label={t('form.useMax', 'Use maximum available {symbol}', { symbol: vault.asset.symbol })}
              sx={{ minWidth: 0 }}
            >
              {t('common.max', 'Max')}
            </Button>
          </Box>
        </Box>
      </Paper>

      <Box sx={{ borderTop: `1px solid ${theme.palette.divider}` }}>
        {mode === 'supply' && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', paddingY: 1.5 }}>
            <Typography sx={{ color: 'text.secondary' }}>{t('common.supplyApy', 'Supply APY')}</Typography>
            <Typography>{vault.supplyApy == null ? '-' : `${vault.supplyApy.toFixed(2)}%`}</Typography>
          </Box>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', paddingY: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Typography sx={{ color: 'text.secondary' }}>
            {mode === 'supply' ? t('form.sharesReceived', 'Vault shares received') : t('form.sharesBurned', 'Vault shares burned')}
          </Typography>
          <Typography>{previewShares === undefined ? '-' : formatRawAmount(previewShares, shareDecimals)}</Typography>
        </Box>
        {mode === 'withdraw' && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', paddingY: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
            <Typography sx={{ color: 'text.secondary' }}>{t('form.shareBalance', 'Share balance')}</Typography>
            <Typography>{formatRawAmount(shareBalance, shareDecimals)}</Typography>
          </Box>
        )}
      </Box>

      {amountExceedsBalance && (
        <Alert severity="warning">
          {mode === 'supply'
            ? t('form.exceedsSupplyLimit', 'Amount exceeds your wallet balance or deposit limit.')
            : t('form.exceedsWithdrawable', 'Amount exceeds your currently withdrawable balance.')}
        </Alert>
      )}
      {transactionMessage && <Alert severity={transactionFailed ? 'error' : 'success'}>{transactionMessage}</Alert>}
      {explorerUrl && (
        <Link
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={t('form.viewTxLabel', 'View transaction {hash} in the block explorer', {
            hash: transactionHash ? `${transactionHash.slice(0, 6)}…${transactionHash.slice(-4)}` : ''
          })}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
        >
          {t('form.viewTx', 'View transaction')} <OpenInNewIcon sx={{ fontSize: 16 }} />
        </Link>
      )}

      <Button
        variant="contained"
        color="secondary"
        size="large"
        onClick={handleSubmit}
        disabled={buttonDisabled}
        aria-busy={busy}
        sx={{ minHeight: 48, fontWeight: 600 }}
      >
        {busy && <CircularProgress size={18} color="inherit" sx={{ marginRight: 1 }} />}
        {buttonLabel}
      </Button>

      {mode === 'withdraw' && maxRedeem > 0n && maxWithdraw === 0n && (
        <Alert severity="info">
          {t('earnForm.noWithdrawable', 'Your shares are present, but the vault currently reports no immediately withdrawable assets.')}
        </Alert>
      )}
    </Stack>
  );
}
