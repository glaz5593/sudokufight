import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_REPORT_FILTERS,
  REPORT_REASONS,
  REPORT_STATUSES,
} from '@sudoku-fight/protocol';
import ts from 'typescript';

import { isolate, isStringKey, LANGS, STRINGS, translate } from './strings';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('strings: Hebrew and English', () => {
  const he = STRINGS.he;
  const en = STRINGS.en;

  it('have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
  });

  it.each(LANGS)('%s: every string is filled in and trimmed', (lang) => {
    for (const [key, text] of Object.entries(STRINGS[lang])) {
      expect({ key, ok: text.length > 0 && text === text.trim() }).toEqual({ key, ok: true });
    }
  });

  it('use the same placeholders for each key', () => {
    for (const key of Object.keys(he) as (keyof typeof he)[]) {
      expect({ key, en: placeholders(en[key]) }).toEqual({ key, en: placeholders(he[key]) });
    }
  });

  it('Hebrew strings are Hebrew, apart from names and symbols', () => {
    // Brand names, codes and symbols may stay Latin; everything else needs a Hebrew letter.
    const latinOk = /^(iOS|Android|Web|English|—|←|→)$/;
    for (const [key, text] of Object.entries(he)) {
      if (latinOk.test(text)) continue;
      expect({ key, hebrew: /[\u0590-\u05ff]/.test(text) }).toEqual({ key, hebrew: true });
    }
  });

  it('translate fills placeholders and leaves unknown ones as they are', () => {
    expect(translate('en', 'pager.status', { page: 2, pages: 3, total: 120 })).toBe(
      'Page 2 of 3 · 120 in all',
    );
    expect(translate('he', 'pager.status', { page: 2, pages: 3, total: 120 })).toBe(
      'עמוד 2 מתוך 3 · 120 בסך הכול',
    );
    expect(translate('en', 'pager.status', { page: 1 })).toBe('Page 1 of {pages} · {total} in all');
  });

  it('every end reason the server stores has a label: the engine three and serverRestart', () => {
    // The engine's EndReason, and the server's own for a ranked game cut short by a restart
    // (apps/server persistence/records.ts SERVER_RESTART).
    const reasons = ['boardComplete', 'lastPlayerStanding', 'practiceEnded', 'serverRestart'];
    for (const reason of reasons)
      expect([reason, isStringKey(`endReason.${reason}`)]).toEqual([reason, true]);
    expect(translate('he', 'endReason.serverRestart')).toBe('נקטע בהפעלה מחדש של השרת');
    expect(translate('en', 'endReason.serverRestart')).toBe('Cut short by a server restart');
  });

  it('every report reason, status, filter and audit action of the contract has its words (spec §3.5)', () => {
    const groups: [string, readonly string[]][] = [
      ['reason', REPORT_REASONS],
      ['reportStatus', REPORT_STATUSES],
      ['reportFilter', ADMIN_REPORT_FILTERS],
      ['auditAction', ADMIN_AUDIT_ACTIONS],
    ];
    for (const [group, values] of groups) {
      for (const value of values) {
        expect([group, value, isStringKey(`${group}.${value}`)]).toEqual([group, value, true]);
      }
    }
    // The three reasons as the spec and the app name them.
    expect(
      REPORT_REASONS.map((r) => {
        const key = `reason.${r}`;
        return isStringKey(key) ? translate('he', key) : key;
      }),
    ).toEqual(['שם פוגעני', 'רמאות', 'אחר']);
  });

  it('isolate wraps left-to-right text in LRI…PDI', () => {
    expect(isolate('+3.5')).toBe('\u2066+3.5\u2069');
  });
});

/**
 * CLAUDE.md: no hard-coded strings in the interface. Every text node and every user-facing attribute in the
 * site's components must come from t(): a literal with a letter in it fails here.
 */
describe('components have no hard-coded text', () => {
  const srcDir = __dirname;
  const files = (readdirSync(srcDir, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx') && !f.includes('testing'))
    .map((f) => path.join(srcDir, f));
  const USER_FACING = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label']);
  const LETTER = /\p{L}/u;

  it('finds the components', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [path.relative(srcDir, f), f]))('%s', (_name, file) => {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && LETTER.test(node.text)) found.push(node.text.trim());
      if (
        ts.isJsxAttribute(node) &&
        USER_FACING.has(node.name.getText(source)) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        LETTER.test(node.initializer.text)
      ) {
        found.push(`${node.name.getText(source)}="${node.initializer.text}"`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(found).toEqual([]);
  });
});
