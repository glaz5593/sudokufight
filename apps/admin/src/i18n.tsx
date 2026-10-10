import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { isLang, isStringKey, type Lang, STRINGS, type StringKey, translate, type Vars } from './strings';

/**
 * The site's language: Hebrew (right to left) by default, English on request. The choice is a per-browser
 * convenience kept in localStorage; it sets <html lang dir>.
 */

const STORAGE_KEY = 'sudoku-fight-admin.lang';

export interface I18n {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: (key: StringKey, vars?: Vars) => string;
  /** A value from the server (a mode, a status…) in words when the dictionary knows it, as is otherwise. */
  label: (group: string, value: string) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18n | null>(null);

function storedLang(): Lang | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLang(value) ? value : null;
  } catch {
    return null;
  }
}

function storeLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode or blocked storage: the choice just doesn't stick.
  }
}

export function I18nProvider({ children, initialLang }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? storedLang() ?? 'he');
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    storeLang(next);
    setLangState(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      dir,
      t: (key, vars) => translate(lang, key, vars),
      label: (group, raw) => {
        const key = `${group}.${raw}`;
        return isStringKey(key) ? translate(lang, key) : raw;
      },
      setLang,
    }),
    [lang, dir, setLang],
  );

  return <I18nContext value={value}>{children}</I18nContext>;
}

/**
 * A string with elements in its placeholders, e.g. an id in a <bdi>: `{id}` becomes nodes.id. Placeholders
 * without a node stay as they are.
 */
export function Rich({ k, nodes }: { k: StringKey; nodes: Record<string, ReactNode> }) {
  const { lang } = useI18n();
  const parts = STRINGS[lang][k].split(/\{(\w+)\}/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <Fragment key={i}>{part in nodes ? nodes[part] : `{${part}}`}</Fragment> : part,
      )}
    </>
  );
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
