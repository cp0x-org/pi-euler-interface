import { useState } from 'react';

import useTranslate from 'hooks/useTranslate';

type CopyToClipboardResult = {
  copySuccess: boolean | null;
  copySuccessMsg: string | null;
  copyToClipboard: (text: string) => Promise<void>;
};

/**
 * Hook to handle copying text to clipboard with success status management
 * @returns {CopyToClipboardResult} Object containing copySuccess state and copyToClipboard function
 */
export const useCopyToClipboard = (): CopyToClipboardResult => {
  const t = useTranslate();
  const [copySuccess, setCopySuccess] = useState<boolean | null>(null);
  const [copySuccessMsg, setCopySuccessMsg] = useState<string | null>(null);

  const copyToClipboard = async (text: string) => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setCopySuccessMsg(t('common.copied', 'Copied'));
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setCopySuccess(false);
      setCopySuccessMsg(t('common.copyFailed', 'Failed to copy'));
    }
  };

  return { copySuccess, copySuccessMsg, copyToClipboard };
};
