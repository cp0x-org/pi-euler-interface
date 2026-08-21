import { describe, expect, it } from 'vitest';

import en from './en.json';
import zh from './zh.json';

// Ids the Euler UI owns (the remaining ids come with the Berry template's menu catalogue).
const APP_NAMESPACES = [
  'borrow',
  'borrowDetail',
  'borrowForm',
  'common',
  'dashboard',
  'discovery',
  'earn',
  'earnForm',
  'explore',
  'footer',
  'form',
  'language',
  'lend',
  'lendDetail',
  'market',
  'nav',
  'portfolio',
  'position',
  'repay',
  'site',
  'vaultDetail',
  'wallet'
];

const english = en as Record<string, string>;
const chinese = zh as Record<string, string>;

const isAppKey = (key: string) => APP_NAMESPACES.includes(key.split('.')[0]);
const appKeys = (catalogue: Record<string, string>) => Object.keys(catalogue).filter(isAppKey).sort();
const placeholders = (message: string) => [...new Set(message.match(/\{\w+\}/g) ?? [])].sort().join();

describe('locale catalogues', () => {
  it('translates every English UI message into Chinese', () => {
    expect(appKeys(chinese)).toEqual(appKeys(english));
  });

  it('keeps the same ICU placeholders in both languages', () => {
    const mismatched = appKeys(english).filter((key) => placeholders(english[key]) !== placeholders(chinese[key]));
    expect(mismatched).toEqual([]);
  });

  it('has no empty message in either language', () => {
    const empty = appKeys(english).filter((key) => !english[key].trim() || !chinese[key].trim());
    expect(empty).toEqual([]);
  });
});
