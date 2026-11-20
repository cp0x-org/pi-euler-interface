import { useEffect, useMemo, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, InputBase, Paper, Stack, Typography, useTheme } from '@mui/material';
import { Address, BaseError, formatUnits, type Hash, parseUnits } from 'viem';
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi';

import { ERC20_ABI, ERC4626_ABI, simulateTokenApproval } from '@/contracts/erc4626';
import { EVAULT_ABI, EVC_ABI } from '@/contracts/evk';
import TransactionLink from 'components/TransactionLink';
import { TokenIcon } from 'components/TokenIcon';
import useTranslate from 'hooks/useTranslate';
import { withApprovalBuffer } from 'utils/repay';
import { formatAssetOutput, normalizePointAmount } from 'utils/formatters';
import { dispatchError, dispatchSuccess, dispatchWarning } from 'utils/snackbar';

// Generic ERC-4626 supply/withdraw form. Unlike EarnVaultActionForm (bound to EulerEarnVault) this
// takes a minimal vault descriptor, so it drives both Lend vault deposits and add/remove collateral.
export type VaultActionMode = 'supply' | 'withdraw';

interface VaultActionFormProps {
  mode: VaultActionMode;
  targetAccount?: Address;
  isOther?: boolean;
  /** The position's liability vault identifies the connector that checks its collateral. */
  liabilityVault?: Address;
  chainId: number;
  vaultAddress: Address;
  asset: { address: Address; symbol: string; decimals: number };
  supplyApy?: number;
  assetPriceUsd: number;
  tokenLogoUrl: string;
  supplyLabel?: string; // e.g. the translated "Supply" (default) or "Add collateral"
  withdrawLabel?: string; // e.g. the translated "Withdraw" (default) or "Remove collateral"
  onSuccess: () => void | Promise<void>;
}

type Step = 'idle' | 'checkingCollateral' | 'resetting' | 'approving' | 'supplying' | 'withdrawing' | 'confirming';

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
  targetAccount,
  isOther = false,
  liabilityVault,
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
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState('');
  const [maxSelected, setMaxSelected] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [hash, setHash] = useState<Hash>();
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<'error' | 'warning' | 'success'>('success');

  const actionVerb =
    mode === 'supply' ? (supplyLabel ?? t('common.supply', 'Supply')) : (withdrawLabel ?? t('common.withdraw', 'Withdraw'));
  const receiver = mode === 'supply' ? (targetAccount ?? address) : address;
  const showTargetShares = mode === 'supply' && !!targetAccount && targetAccount.toLowerCase() !== address?.toLowerCase();
  const requiresCollateralCheck = mode === 'supply' && !!targetAccount;
  const collateralKey = ['euler', 'position-collateral', chainId, liabilityVault, targetAccount, vaultAddress, isOther] as const;
  const readCollateralStatus = async (blockNumber?: bigint) => {
    if (!publicClient || !liabilityVault || !targetAccount) {
      throw new Error(t('form.collateralCheckUnavailable', 'Could not verify collateral status on this network.'));
    }
    const block = blockNumber ?? (await publicClient.getBlockNumber({ cacheTime: 0 }));
    const connector = await publicClient.readContract({
      address: liabilityVault,
      abi: EVAULT_ABI,
      functionName: 'EVC',
      blockNumber: block
    });
    const [enabled, controller, debt] = await Promise.all([
      publicClient.readContract({
        address: connector,
        abi: EVC_ABI,
        functionName: 'isCollateralEnabled',
        args: [targetAccount, vaultAddress],
        blockNumber: block
      }),
      isOther
        ? publicClient.readContract({
            address: connector,
            abi: EVC_ABI,
            functionName: 'isControllerEnabled',
            args: [targetAccount, liabilityVault],
            blockNumber: block
          })
        : true,
      isOther
        ? publicClient.readContract({
            address: liabilityVault,
            abi: EVAULT_ABI,
            functionName: 'debtOf',
            args: [targetAccount],
            blockNumber: block
          })
        : undefined
    ]);
    return { enabled, open: controller && (debt === undefined || debt > 0n) };
  };
  const collateralStatus = useQuery({
    queryKey: collateralKey,
    enabled: requiresCollateralCheck && !!publicClient && !!liabilityVault,
    queryFn: () => readCollateralStatus(),
    refetchInterval: 15_000
  });
  const collateralBlocked =
    requiresCollateralCheck && !(collateralStatus.isSuccess && collateralStatus.data.enabled && collateralStatus.data.open);
  const collateralCheckUnavailable = !publicClient || !liabilityVault || collateralStatus.isError;

  useEffect(() => {
    setAmount('');
    setMaxSelected(false);
    setHash(undefined);
    setMessage('');
    setSeverity('success');
  }, [mode]);

  const reads = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          { address: asset.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId },
          { address: asset.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, vaultAddress], chainId }
        ]
      : [],
    query: { enabled: Boolean(address), refetchInterval: 15_000 }
  });
  const walletBalance = (reads.data?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance = (reads.data?.[1]?.result as bigint | undefined) ?? 0n;
  const vaultReads = useReadContracts({
    allowFailure: true,
    contracts: receiver
      ? [
          {
            address: vaultAddress,
            abi: ERC4626_ABI,
            functionName: mode === 'supply' ? 'maxDeposit' : 'maxWithdraw',
            args: [receiver],
            chainId
          },
          { address: vaultAddress, abi: ERC4626_ABI, functionName: 'balanceOf', args: [receiver], chainId }
        ]
      : [],
    query: { enabled: Boolean(receiver), refetchInterval: 15_000 }
  });
  const vaultLimit = vaultReads.data?.[0]?.result as bigint | undefined;
  const targetShares = vaultReads.data?.[1]?.result as bigint | undefined;
  const shareBalance = targetShares ?? 0n;

  const supplyLimit = vaultLimit === undefined ? walletBalance : minBigInt(walletBalance, vaultLimit);
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
  const available = mode === 'supply' ? supplyLimit : vaultLimit || fullWithdrawable;

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

  const wait = async (txHash: Hash) => {
    if (!publicClient) throw new Error(t('form.rpcUnavailable', 'RPC client is not available'));
    setHash(txHash);
    setStep('confirming');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    if (receipt.status !== 'success') throw new Error(t('form.txReverted', 'Transaction reverted'));
    return receipt;
  };

  const submit = async () => {
    if (!address) return openConnectModal?.();
    if (wrongNetwork) return switchChainAsync({ chainId });
    if (!publicClient || !receiver || amountRaw <= 0n || exceeds || busy || collateralBlocked) return;
    setMessage('');
    setSeverity('success');
    setHash(undefined);
    try {
      let liveAllowance = allowance;
      if (mode === 'supply') {
        setStep(requiresCollateralCheck ? 'checkingCollateral' : 'supplying');
        const [status, wallet, vault] = await Promise.all([
          requiresCollateralCheck ? collateralStatus.refetch() : undefined,
          reads.refetch(),
          vaultReads.refetch()
        ]);
        if (status && (!status.isSuccess || !status.data.open || !status.data.enabled)) return;
        const freshBalance = wallet.data?.[0]?.result;
        const freshAllowance = wallet.data?.[1]?.result;
        const freshLimit = vault.data?.[0]?.result;
        if (
          !wallet.isSuccess ||
          !vault.isSuccess ||
          typeof freshBalance !== 'bigint' ||
          typeof freshAllowance !== 'bigint' ||
          typeof freshLimit !== 'bigint'
        ) {
          throw new Error(t('form.rpcUnavailable', 'RPC client is not available'));
        }
        liveAllowance = freshAllowance;
        const maximum = minBigInt(freshBalance, freshLimit);
        if (maxSelected && amountRaw !== maximum) {
          setAmount(inputFromRaw(maximum, asset.decimals));
          return;
        }
        const requiresApproval = amountRaw > liveAllowance;
        if (amountRaw > maximum || requiresApproval !== needsApprove) return;
      }

      if (needsApprove) {
        const approve = async (amount: bigint) => {
          const request = await simulateTokenApproval(publicClient, {
            account: address,
            token: asset.address,
            spender: vaultAddress,
            amount,
            chainId
          });
          if (!request) throw new Error(t('form.approvalDeclined', 'The token declined the spending approval.'));
          await wait(await writeContractAsync(request));
        };
        if (liveAllowance > 0n) {
          setStep('resetting');
          await approve(0n);
        }
        setStep('approving');
        await approve(maxSelected ? withApprovalBuffer(amountRaw) : amountRaw);
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

      let warning: string | undefined;
      if (mode === 'supply') {
        setStep('supplying');
        const deposit = await publicClient.simulateContract({
          account: address,
          address: vaultAddress,
          abi: ERC4626_ABI,
          functionName: 'deposit',
          args: [amountRaw, receiver]
        });
        const receipt = await wait(await writeContractAsync(deposit.request));
        if (requiresCollateralCheck) {
          setStep('checkingCollateral');
          try {
            // A load-balanced RPC can return a "latest" state older than the confirmed deposit.
            const head = await publicClient.getBlockNumber({ cacheTime: 0 });
            const status = await readCollateralStatus(head > receipt.blockNumber ? head : receipt.blockNumber);
            queryClient.setQueryData(collateralKey, status);
            if (!status.enabled) {
              warning = t(
                'form.depositUnprotected',
                'Deposit landed on the account, but this vault is not enabled as its collateral — the position is not protected.'
              );
            } else if (!status.open) {
              warning = t('form.depositClosed', 'The deposit landed on the account, but this borrow position is closed.');
            }
          } catch {
            warning = t('form.depositUnverified', 'Deposit landed on the account, but its collateral status could not be verified.');
          }
        }
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
      }
      if (warning) {
        setMessage(warning);
        setSeverity('warning');
        dispatchWarning(warning);
      } else {
        setMessage(
          t('form.actionConfirmed', '{action} confirmed: {amount} {symbol}.', { action: actionVerb, amount, symbol: asset.symbol })
        );
        dispatchSuccess(t('form.actionTxConfirmed', '{action} transaction confirmed', { action: actionVerb }));
      }
      setAmount('');
      setMaxSelected(false);
      await Promise.all([reads.refetch(), vaultReads.refetch()]);
      await onSuccess();
    } catch (error) {
      const text =
        error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : t('form.txFailed', 'Transaction failed');
      setMessage(text);
      setSeverity('error');
      dispatchError(text);
    } finally {
      setStep('idle');
    }
  };

  const buttonLabel = busy
    ? (
        {
          checkingCollateral: t('form.checkingCollateral', 'Checking collateral status...'),
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
            onChange={(event) => {
              setMaxSelected(false);
              setAmount(formatAssetOutput(event.target.value));
            }}
            disabled={busy}
            readOnly={!address || collateralBlocked}
            placeholder="0.00"
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
              onClick={() => {
                setMaxSelected(true);
                setAmount(inputFromRaw(available, asset.decimals));
              }}
              disabled={!address || available === 0n || busy || collateralBlocked}
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
        {showTargetShares && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 1,
              paddingY: 1.5,
              borderTop: `1px solid ${theme.palette.divider}`
            }}
          >
            <Typography color="text.secondary">{t('form.positionShareBalance', 'Position share balance')}</Typography>
            <Typography>
              {targetShares === undefined ? '—' : rawText(targetShares, shareDecimals)}
              {targetShares !== undefined &&
                preview.data !== undefined &&
                ` → ${rawText(targetShares + (preview.data as bigint), shareDecimals)}`}
            </Typography>
          </Box>
        )}
        {mode === 'withdraw' && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', paddingY: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
            <Typography color="text.secondary">{t('form.shareBalance', 'Share balance')}</Typography>
            <Typography>{rawText(shareBalance, shareDecimals)}</Typography>
          </Box>
        )}
      </Box>

      {collateralBlocked && (
        <Alert
          severity={
            collateralCheckUnavailable || (collateralStatus.data && (!collateralStatus.data.enabled || !collateralStatus.data.open))
              ? 'warning'
              : 'info'
          }
        >
          {collateralCheckUnavailable
            ? t('form.collateralCheckUnavailable', 'Could not verify collateral status on this network.')
            : collateralStatus.data?.open === false
              ? t('form.positionClosed', 'This borrow position is closed. You cannot add collateral for this account.')
              : collateralStatus.data?.enabled === false
                ? t('form.collateralDisabled', 'The receiving account must enable this vault as collateral before you can add funds.')
                : t('form.checkingCollateral', 'Checking collateral status...')}
        </Alert>
      )}
      {exceeds && (
        <Alert severity="warning">
          {mode === 'supply'
            ? t('form.exceedsSupplyLimit', 'Amount exceeds your wallet balance or deposit limit.')
            : t('form.exceedsWithdrawable', 'Amount exceeds your currently withdrawable balance.')}
        </Alert>
      )}
      {message && <Alert severity={severity}>{message}</Alert>}
      {hash && <TransactionLink chainId={chainId} hash={hash} />}

      <Button
        variant="contained"
        color="secondary"
        size="large"
        onClick={submit}
        disabled={busy || (Boolean(address) && !wrongNetwork && (amountRaw <= 0n || exceeds || collateralBlocked))}
        aria-busy={busy}
        sx={{ minHeight: 48, fontWeight: 600 }}
      >
        {busy && <CircularProgress size={18} color="inherit" sx={{ marginRight: 1 }} />}
        {buttonLabel}
      </Button>
    </Stack>
  );
}
