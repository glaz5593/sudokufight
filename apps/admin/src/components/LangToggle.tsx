import { useI18n } from '../i18n';

/** Switches Hebrew ⇄ English. The button names the other language, in that language. */
export function LangToggle() {
  const { t, lang, setLang } = useI18n();
  const other = lang === 'he' ? 'en' : 'he';
  return (
    <button
      type="button"
      className="btn btn-ghost"
      lang={other}
      title={t('lang.label')}
      onClick={() => setLang(other)}
    >
      {t('lang.other')}
    </button>
  );
}
