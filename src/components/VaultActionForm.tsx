import { useEffect, useMemo, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Alert, Box, Button, CircularProgress, InputBase, Link, Paper, Stack, Typography, useTheme } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Address, BaseError, formatUnits, parseUnits } from 'viem';
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi';

import { ERC20_ABI, ERC4626_ABI } from '@/contracts/erc4626';
import { TokenIcon } from 'components/TokenIcon';
import useTranslate from 'hooks/useTranslate';
import { formatAssetOutput, normalizePointAmount } from 'utils/formatters';
import { dispatchError, dispatchSuccess } from 'utils/snackbar';

// Generic ERC-4626 supply/withdraw form. Unlike EarnVaultActionForm (bound to EulerEarnVault) this
// takes a minimal vault descriptor, so it drives both Lend vault deposits and add/remove collateral.
export type VaultActionMode = 'supply' | 'withdraw';

interface VaultActionFormProps {
  mode: VaultActionMode;
  chainId: number;
  vaultAddress: Address;
  asset: { address: Address; symbol: string; decimals: number };
  supplyApy?: number;
  assetPriceUsd: number;
  tokenLogoUrl: string;
  supplyLabel?: string; // e.g. the translated "Supply" (default) or "Add collateral"
  withdrawLabel?: string; // e.g. the translated "Withdraw" (default) or "Remove collateral"
  onSuccess: () => void;
}

type Step = 'idle' | 'resetting' | 'approving' | 'supplying' | 'withdrawing' | 'confirming';

function rawText(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
function inputFromRaw(value: bigint, decimals: number): string {
  return formatUnits(value, decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}
function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export default function VaultActionForm({
  mode,
  chainId,
  vaultAddress,
  asset,
  supplyApy,
  assetPriceUsd,
  tokenLogoUrl,
  supplyLabel,
  withdrawLabel,
  onSuccess
}: VaultActionFormProps) {
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

  const actionVerb =
    mode === 'supply' ? (supplyLabel ?? t('common.supply', 'Supply')) : (withdrawLabel ?? t('common.withdraw', 'Withdraw'));

  useEffect(() => {
    setAmount('');
    setHash(undefined);
    setMessage('');
    setFailed(false);
  }, [mode]);

  const reads = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          { address: asset.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId },
          { address: asset.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, vaultAddress], chainId },
          { address: vaultAddress, abi: ERC4626_ABI, functionName: 'maxDeposit', args: [address], chainId },
          { address: vaultAddress, abi: ERC4626_ABI, functionName: 'maxWithdraw', args: [address], chainId },
          { address: vaultAddress, abi: ERC4626_ABI, functionName: 'balanceOf', args: [address], chainId }
        ]
      : [],
    query: { enabled: Boolean(address), refetchInterval: 15_000 }
  });
  const walletBalance = (reads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance = (reads.data?.[1]?.result as bigint | undefined) ?? 0n;
  const maxDeposit = reads.data?.[2]?.result as bigint | undefined;
  const maxWithdraw = (reads.data?.[3]?.result as bigint | undefined) ?? 0n;
  const shareBalance = (reads.data?.[4]?.result as bigint | undefined) ?? 0n;

  const supplyLimit = maxDeposit === undefined ? walletBalance : minBigInt(walletBalance, maxDeposit);
  // EVK vaults report maxWithdraw = 0 whenever the account has an enabled controller (an open
  // borrow) — even for unrelated deposits — because the vault can't evaluate the controller's
  // liquidity check in a view. Fall back to the account's full share value (convertToAssets) and let
  // the on-chain simulation gate anything that would break the position.
  const fullWithdrawableQuery = useReadContract({
    address: vaultAddress,
    abi: ERC4626_ABI,
    functionName: 'convertToAssets',
    args: [shareBalance],
    chainId,
    query: { enabled: mode === 'withdraw' && shareBalance > 0n }
  });
  const fullWithdrawable = (fullWithdrawableQuery.data as bigint | undefined) ?? 0n;
  const available = mode === 'supply' ? supplyLimit : maxWithdraw > 0n ? maxWithdraw : fullWithdrawable;

  const amountRaw = useMemo(() => {
    try {
      return parseUnits(normalizePointAmount(amount || '0'), asset.decimals);
    } catch {
      return 0n;
    }
  }, [amount, asset.decimals]);

  const preview = useReadContract({
    address: vaultAddress,
    abi: ERC4626_ABI,
    functionName: mode === 'supply' ? 'previewDeposit' : 'previewWithdraw',
    args: [amountRaw],
    chainId,
    query: { enabled: amountRaw > 0n }
  });
  const shareDecimalsQuery = useReadContract({ address: vaultAddress, abi: ERC4626_ABI, functionName: 'decimals', chainId });
  const shareDecimals = Number(shareDecimalsQuery.data ?? asset.decimals);

  const busy = step !== 'idle';
  const wrongNetwork = Boolean(address && connectedChainId !== chainId);
  const exceeds = amountRaw > available;
  const needsApprove = mode === 'supply' && amountRaw > allowance;

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
    if (!publicClient || amountRaw <= 0n || exceeds || busy) return;
    setMessage('');
    setFailed(false);
    setHash(undefined);
    try {
      if (needsApprove) {
        if (allowance > 0n) {
          setStep('resetting');
          const reset = await publicClient.simulateContract({
            account: address,
            address: asset.address,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [vaultAddress, 0n]
          });
          await wait(await writeContractAsync(reset.request));
        }
        setStep('approving');
        const approval = await publicClient.simulateContract({
          account: address,
          address: asset.address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [vaultAddress, amountRaw]
        });
        await wait(await writeContractAsync(approval.request));
        setStep('idle');
        setMessage(
          t('form.approvalConfirmedRetry', 'Approval confirmed. Submit again to {action} {symbol}.', {
            action: actionVerb.toLowerCase(),
            symbol: asset.symbol
          })
        );
        dispatchSuccess(t('form.approvalConfirmed', '{symbol} approval confirmed', { symbol: asset.symbol }));
        await reads.refetch();
        return;
      }

      if (mode === 'supply') {
        setStep('supplying');
        const deposit = await publicClient.simulateContract({
          account: address,
          address: vaultAddress,
          abi: ERC4626_ABI,
          functionName: 'deposit',
          args: [amountRaw, address]
        });
        await wait(await writeContractAsync(deposit.request));
        setMessage(
          t('form.actionConfirmed', '{action} confirmed: {amount} {symbol}.', { action: actionVerb, amount, symbol: asset.symbol })
        );
        dispatchSuccess(t('form.actionTxConfirmed', '{action} transaction confirmed', { action: actionVerb }));
      } else {
        setStep('withdrawing');
        const withdrawTx = await publicClient.simulateContract({
          account: address,
          address: vaultAddress,
          abi: ERC4626_ABI,
          functionName: 'withdraw',
          args: [amountRaw, address, address]
        });
        await wait(await writeContractAsync(withdrawTx.request));
        setMessage(
          t('form.actionConfirmed', '{action} confirmed: {amount} {symbol}.', { action: actionVerb, amount, symbol: asset.symbol })
        );
        dispatchSuccess(t('form.actionTxConfirmed', '{action} transaction confirmed', { action: actionVerb }));
      }
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
          approving: t('form.approvingSymbol', 'Approving {symbol}...', { symbol: asset.symbol }),
          supplying: t('form.actionInProgress', '{action}...', { action: actionVerb }),
          withdrawing: t('form.actionInProgress', '{action}...', { action: actionVerb }),
          confirming: t('form.confirmingTx', 'Confirming transaction...'),
          idle: ''
        } as Record<Step, string>
      )[step]
    : !address
      ? t('wallet.connectShort', 'Connect wallet')
      : wrongNetwork
        ? t('wallet.switchNetwork', 'Switch network')
        : needsApprove
          ? t('form.approveSymbol', 'Approve {symbol}', { symbol: asset.symbol })
          : t('form.actionWithSymbol', '{action} {symbol}', { action: actionVerb, symbol: asset.symbol });

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h3">{mode === 'supply' && supplyApy != null ? t('common.supplyApy', 'Supply APY') : actionVerb}</Typography>
        <Typography variant="h3">{mode === 'supply' && supplyApy != null ? `${supplyApy.toFixed(2)}%` : ''}</Typography>
      </Box>

      <Paper variant="outlined" sx={{ padding: 2, borderRadius: 1, borderColor: theme.palette.divider }}>
        <Typography variant="body2" color="text.secondary">
          {t('form.amountLabel', '{action} amount', { action: actionVerb })}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginY: 1 }}>
          <InputBase
            fullWidth
            value={amount}
            onChange={(event) => setAmount(formatAssetOutput(event.target.value))}
            placeholder="0.00"
            disabled={busy}
            inputProps={{
              inputMode: 'decimal',
              'aria-label': t('form.amountInputLabel', 'Amount of {symbol} to {action}', {
                symbol: asset.symbol,
                action: actionVerb.toLowerCase()
              })
            }}
            sx={{ '& input': { fontSize: 32, fontWeight: 500, padding: 0 } }}
          />
          <TokenIcon symbol={asset.symbol} logoUrl={tokenLogoUrl} avatarProps={{ sx: { width: 24, height: 24, fontSize: 9 } }} />
          <Typography variant="h4">{asset.symbol}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography color="text.secondary">
            ${(Number(normalizePointAmount(amount || '0')) * assetPriceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </Typography>
          <Typography color="text.secondary">
            {address ? rawText(available, asset.decimals) : '0'} {asset.symbol}{' '}
            <Button
              size="small"
              onClick={() => setAmount(inputFromRaw(available, asset.decimals))}
              disabled={!address || available === 0n || busy}
              aria-label={t('form.useMax', 'Use maximum available {symbol}', { symbol: asset.symbol })}
            >
              {t('common.max', 'Max')}
            </Button>
          </Typography>
        </Box>
      </Paper>

      <Box sx={{ borderTop: `1px solid ${theme.palette.divider}` }}>
        {mode === 'supply' && supplyApy != null && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', paddingY: 1.5 }}>
            <Typography color="text.secondary">{t('common.supplyApy', 'Supply APY')}</Typography>
            <Typography>{supplyApy.toFixed(2)}%</Typography>
          </Box>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', paddingY: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Typography color="text.secondary">
            {mode === 'supply' ? t('form.sharesReceived', 'Vault shares received') : t('form.sharesBurned', 'Vault shares burned')}
          </Typography>
          <Typography>{preview.data === undefined ? '-' : rawText(preview.data as bigint, shareDecimals)}</Typography>
        </Box>
        {mode === 'withdraw' && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', paddingY: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
            <Typography color="text.secondary">{t('form.shareBalance', 'Share balance')}</Typography>
            <Typography>{rawText(shareBalance, shareDecimals)}</Typography>
          </Box>
        )}
      </Box>

      {exceeds && (
        <Alert severity="warning">
          {mode === 'supply'
            ? t('form.exceedsSupplyLimit', 'Amount exceeds your wallet balance or deposit limit.')
            : t('form.exceedsWithdrawable', 'Amount exceeds your currently withdrawable balance.')}
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
        disabled={busy || (Boolean(address) && !wrongNetwork && (amountRaw <= 0n || exceeds))}
        aria-busy={busy}
        sx={{ minHeight: 48, fontWeight: 600 }}
      >
        {busy && <CircularProgress size={18} color="inherit" sx={{ marginRight: 1 }} />}
        {buttonLabel}
      </Button>
    </Stack>
  );
}
