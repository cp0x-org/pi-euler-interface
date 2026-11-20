import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link } from '@mui/material';
import type { Hash } from 'viem';
import { usePublicClient } from 'wagmi';

import useTranslate from 'hooks/useTranslate';

export default function TransactionLink({ hash, chainId }: { hash: Hash; chainId: number }) {
  const t = useTranslate();
  const explorer = usePublicClient({ chainId })?.chain?.blockExplorers?.default.url;
  if (!explorer) return null;
  return (
    <Link
      href={`${explorer}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      aria-label={t('form.viewTxLabel', 'View transaction {hash} in the block explorer', { hash: `${hash.slice(0, 6)}…${hash.slice(-4)}` })}
    >
      {t('form.viewTx', 'View transaction')} <OpenInNewIcon sx={{ fontSize: 16, verticalAlign: 'middle' }} />
    </Link>
  );
}
