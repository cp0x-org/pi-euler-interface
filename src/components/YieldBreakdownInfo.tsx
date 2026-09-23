import { Box, Divider, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import useTranslate from 'hooks/useTranslate';
import { EulerApyBreakdown } from 'types/euler';

/**
 * The info tooltip next to the Net APY / ROE figures, mirroring the official Euler app.
 *
 * Both numbers come straight from the portfolio API and share the same components — the `apy`
 * variant measures them on the supplied collateral, the `roe` variant on the position's equity
 * (so every component is multiplied by the leverage). `borrowing` already arrives negative.
 */
export type YieldKind = 'apy' | 'roe';

export interface BreakdownRow {
  label: string;
  value: string;
  caption?: string;
}

export function formatSignedPercent(value: number | undefined): string {
  if (!Number.isFinite(value)) return '—';
  const amount = value as number;
  return `${amount < 0 ? '−' : '+'} ${Math.abs(amount).toFixed(2)}%`;
}

export default function YieldBreakdownInfo({
  kind,
  breakdown,
  total,
  leadRows = []
}: {
  kind: YieldKind;
  breakdown?: EulerApyBreakdown;
  total: number;
  leadRows?: BreakdownRow[];
}) {
  const theme = useTheme();
  const t = useTranslate();

  const description =
    kind === 'apy'
      ? t(
          'yield.netApyDescription',
          'Net APY estimates the annualized return on your supplied collateral after accounting for borrowing costs and any reward incentives. A positive net APY means the combined yield exceeds the cost of borrowing. A negative net APY means borrowing costs outweigh the yield.'
        )
      : t(
          'yield.roeDescription',
          'ROE (Return on Equity) estimates the annualized return on your own capital in this leveraged position based on your actual LTV and multiplier.'
        );

  const componentRows: BreakdownRow[] = breakdown
    ? [
        {
          label: kind === 'apy' ? t('yield.supplyApy', 'Supply APY') : t('yield.supplyRoe', 'Supply ROE'),
          value: formatSignedPercent(breakdown.lending)
        },
        {
          label: kind === 'apy' ? t('yield.intrinsicApy', 'Intrinsic APY') : t('yield.intrinsicRoe', 'Intrinsic ROE'),
          value: formatSignedPercent(breakdown.intrinsicApy)
        },
        ...(breakdown.rewards
          ? [
              {
                label: kind === 'apy' ? t('yield.rewardsApy', 'Rewards APY') : t('yield.rewardsRoe', 'Rewards ROE'),
                value: formatSignedPercent(breakdown.rewards)
              }
            ]
          : []),
        {
          label: kind === 'apy' ? t('yield.borrowCostApy', 'Borrow cost APY') : t('yield.borrowCostRoe', 'Borrow cost ROE'),
          value: formatSignedPercent(breakdown.borrowing)
        }
      ]
    : [];

  const totalRow: BreakdownRow = {
    label: kind === 'apy' ? t('common.netApy', 'Net APY') : t('common.roe', 'ROE'),
    caption:
      kind === 'apy'
        ? t('yield.netApyTotalCaption', 'Return on supplied collateral after borrow costs')
        : t('yield.roeTotalCaption', 'Return on equity at your current multiplier'),
    value: Number.isFinite(total) ? `= ${total.toFixed(2)}%` : '—'
  };

  return (
    <Tooltip
      arrow
      enterTouchDelay={0}
      leaveTouchDelay={8000}
      title={
        <Box sx={{ maxWidth: 260, paddingY: 0.5 }}>
          <Typography variant="caption" sx={{ display: 'block', marginBottom: 1 }}>
            {description}
          </Typography>
          <Stack spacing={0.75}>
            {[...leadRows, ...componentRows].map((row) => (
              <TooltipRow key={row.label} row={row} />
            ))}
            <Divider sx={{ borderColor: 'currentColor', opacity: 0.25 }} />
            <TooltipRow row={totalRow} emphasized />
          </Stack>
        </Box>
      }
    >
      <InfoOutlinedIcon sx={{ fontSize: 14, color: theme.palette.grey[500], cursor: 'help' }} />
    </Tooltip>
  );
}

function TooltipRow({ row, emphasized }: { row: BreakdownRow; emphasized?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ display: 'block', fontWeight: emphasized ? 600 : 400 }}>
          {row.label}
        </Typography>
        {row.caption && (
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.7 }}>
            {row.caption}
          </Typography>
        )}
      </Box>
      <Typography variant="caption" sx={{ whiteSpace: 'nowrap', fontWeight: emphasized ? 600 : 400 }}>
        {row.value}
      </Typography>
    </Box>
  );
}
