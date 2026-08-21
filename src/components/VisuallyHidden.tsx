import { ReactNode } from 'react';
import Box from '@mui/material/Box';

// Text that exists only in the accessibility tree (screen readers, browser automation, AI agents).
// It is removed from the visual flow, so adding it can never change the rendered layout.
export const visuallyHiddenSx = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  height: '1px',
  width: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap'
} as const;

interface VisuallyHiddenProps {
  children?: ReactNode;
  /** e.g. "status" for async/transaction progress, "alert" for errors that need attention. */
  role?: string;
  'aria-live'?: 'off' | 'polite' | 'assertive';
  'aria-atomic'?: boolean;
  id?: string;
}

export default function VisuallyHidden({ children, ...rest }: VisuallyHiddenProps) {
  return (
    <Box component="span" sx={visuallyHiddenSx} {...rest}>
      {children}
    </Box>
  );
}
