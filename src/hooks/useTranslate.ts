import { useCallback } from 'react';
import { PrimitiveType, useIntl } from 'react-intl';

/**
 * Thin wrapper over react-intl's `formatMessage` for the Euler UI strings.
 *
 * The English copy lives in `src/utils/locales/en.json`; the `defaultMessage` argument keeps the
 * same English text next to the markup so a missing catalogue entry can never render a raw id.
 * Chinese lives in `src/utils/locales/zh.json` and is picked through `useConfig().i18n`.
 */
export type TranslateValues = Record<string, PrimitiveType>;

export function useTranslate() {
  const intl = useIntl();

  return useCallback(
    (id: string, defaultMessage: string, values?: TranslateValues) => intl.formatMessage({ id, defaultMessage }, values),
    [intl]
  );
}

export default useTranslate;
