import { useId } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select, { SelectChangeEvent } from '@mui/material/Select';
import { useTheme } from '@mui/material/styles';

import useConfig from 'hooks/useConfig';
import useTranslate from 'hooks/useTranslate';
import { I18n } from 'types/config';

// The two languages the interface ships with. `short` is what the closed dropdown shows so the
// control stays compact in the header; `label` is the full name shown in the option list.
const LANGUAGES: { value: I18n; short: string; label: string }[] = [
  { value: 'en', short: 'EN', label: 'English' },
  { value: 'zh', short: '中文', label: '中文' }
];

/**
 * Language dropdown for the app header. Purely a UI preference: it only writes the chosen locale
 * to the persisted app config (localStorage) and never touches wallet, network or contract state.
 */
export default function LanguageSwitcher() {
  const theme = useTheme();
  const { i18n, onChangeLocale } = useConfig();
  const t = useTranslate();
  const labelId = useId();

  // A locale outside the shipped list (e.g. left over in localStorage) falls back to English.
  const value: I18n = LANGUAGES.some((language) => language.value === i18n) ? i18n : 'en';

  const handleChange = (event: SelectChangeEvent<I18n>) => {
    onChangeLocale(event.target.value as I18n);
  };

  return (
    <Select<I18n>
      id={labelId}
      size="small"
      value={value}
      onChange={handleChange}
      // MUI puts `inputProps` on the element that carries role="combobox", so the control is named
      // "Select language" while its rendered value ("EN" / "中文") stays the exposed value.
      inputProps={{ 'aria-label': t('language.select', 'Select language') }}
      renderValue={(selected) => LANGUAGES.find((language) => language.value === selected)?.short ?? selected}
      sx={{
        minWidth: 76,
        height: 36,
        color: 'text.primary',
        '& .MuiSelect-select': { paddingY: 0.5, paddingLeft: 1.25, fontSize: '0.875rem', fontWeight: 500 },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.divider },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.secondary.main }
      }}
    >
      {LANGUAGES.map((language) => (
        <MenuItem key={language.value} value={language.value}>
          {language.label}
        </MenuItem>
      ))}
    </Select>
  );
}
