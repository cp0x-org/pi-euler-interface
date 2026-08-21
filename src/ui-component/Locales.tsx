import React, { useState, useEffect } from 'react';

// third party
import { IntlProvider, MessageFormatElement, ReactIntlErrorCode } from 'react-intl';
import useConfig from 'hooks/useConfig';

// types
import { I18n } from 'types/config';

// load locales files
function loadLocaleData(i18n: I18n) {
  switch (i18n) {
    case 'fr':
      return import('utils/locales/fr.json');
    case 'ro':
      return import('utils/locales/ro.json');
    case 'zh':
      return import('utils/locales/zh.json');
    default:
      return import('utils/locales/en.json');
  }
}

// Every UI string ships an English `defaultMessage`, so a catalogue entry missing from a locale
// simply renders the English copy. Keep those expected fallbacks out of the console.
function ignoreMissingTranslations(error: { code?: string }) {
  if (error?.code === ReactIntlErrorCode.MISSING_TRANSLATION) return;
  console.error(error);
}

// ==============================|| LOCALIZATION ||============================== //

interface LocalsProps {
  children: React.ReactNode;
}

export default function Locales({ children }: LocalsProps) {
  const { i18n } = useConfig();
  const [messages, setMessages] = useState<Record<string, string> | Record<string, MessageFormatElement[]> | undefined>();

  useEffect(() => {
    loadLocaleData(i18n).then((d: { default: Record<string, string> | Record<string, MessageFormatElement[]> | undefined }) => {
      setMessages(d.default);
    });
    // Assistive technology and translation tools read the document language from this attribute.
    document.documentElement.lang = i18n === 'zh' ? 'zh-Hans' : i18n;
  }, [i18n]);

  return (
    <>
      {messages && (
        <IntlProvider locale={i18n} defaultLocale="en" messages={messages} onError={ignoreMissingTranslations}>
          {children}
        </IntlProvider>
      )}
    </>
  );
}
