import { ADMIN_REPORT_FILTERS, type AdminReportFilter } from '@sudoku-fight/protocol';
import { useMemo, useSyncExternalStore } from 'react';

/**
 * A small hash router: `#/installs?search=x&page=2`, `#/users/<id>`, `#/reports?status=all`,
 * `#/levels?days=90&chapter=3`. The hash keeps
 * the server's job simple (one index.html under /admin), and Back / Forward / reload keep the page, its
 * search, its filter and its paging.
 */

export const DEFAULT_DAYS = 30;
export const DAY_RANGES = [7, 30, 90] as const;
export const MAX_DAYS = 365;

/** The reports page's default filter (the server's too): what still needs an answer. */
export const DEFAULT_REPORT_FILTER: AdminReportFilter = 'open';

export type Section =
  'overview' | 'installs' | 'users' | 'games' | 'reports' | 'audit' | 'screens' | 'levels';

/** The levels page's chapter filter takes a chapter up to this (the server says which there are). */
export const MAX_CHAPTER = 1000;

export type Route =
  | { name: 'overview'; days?: number }
  | { name: 'installs'; search?: string; page?: number }
  | { name: 'install'; id: string }
  | { name: 'users'; search?: string; page?: number }
  | { name: 'user'; id: string }
  | { name: 'games'; mode?: string; search?: string; page?: number }
  | { name: 'game'; id: string }
  | { name: 'reports'; status?: AdminReportFilter; page?: number }
  | { name: 'audit'; page?: number }
  | { name: 'screens'; days?: number }
  /**
   * Staged practice (1.0.2). `chapter`: only that chapter's levels; none or 0, every chapter. `allRevs` (1.0.3):
   * every rev of each level together (the plays from before a rebuild too); by default its rev now.
   */
  | { name: 'levels'; days?: number; chapter?: number; allRevs?: boolean }
  | { name: 'notFound' };

/** The nav item a route belongs to. */
export function sectionOf(route: Route): Section | null {
  switch (route.name) {
    case 'overview':
    case 'installs':
    case 'users':
    case 'games':
    case 'reports':
    case 'audit':
    case 'screens':
    case 'levels':
      return route.name;
    case 'install':
      return 'installs';
    case 'user':
      return 'users';
    case 'game':
      return 'games';
    case 'notFound':
      return null;
  }
}

function positiveInt(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= 1 && n <= max ? n : fallback;
}

function reportFilter(value: string | null): AdminReportFilter {
  return (ADMIN_REPORT_FILTERS as readonly (string | null)[]).includes(value)
    ? (value as AdminReportFilter)
    : DEFAULT_REPORT_FILTER;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?', 2);
  const segments = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart);
  const [first = 'overview', second, ...rest] = segments;
  if (rest.length > 0) return { name: 'notFound' };

  if (second !== undefined) {
    const id = decode(second);
    if (id === null || id === '') return { name: 'notFound' };
    if (first === 'installs') return { name: 'install', id };
    if (first === 'users') return { name: 'user', id };
    if (first === 'games') return { name: 'game', id };
    return { name: 'notFound' };
  }

  const page = positiveInt(query.get('page'), 1);
  const days = positiveInt(query.get('days'), DEFAULT_DAYS, MAX_DAYS);
  switch (first) {
    case 'overview':
      return { name: 'overview', days };
    case 'screens':
      return { name: 'screens', days };
    case 'levels':
      return {
        name: 'levels',
        days,
        chapter: positiveInt(query.get('chapter'), 0, MAX_CHAPTER),
        ...(query.get('allRevs') === '1' ? { allRevs: true } : null),
      };
    case 'installs':
      return { name: 'installs', search: query.get('search') ?? '', page };
    case 'users':
      return { name: 'users', search: query.get('search') ?? '', page };
    case 'games':
      return { name: 'games', mode: query.get('mode') ?? '', search: query.get('search') ?? '', page };
    case 'reports':
      return { name: 'reports', status: reportFilter(query.get('status')), page };
    case 'audit':
      return { name: 'audit', page };
    default:
      return { name: 'notFound' };
  }
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/** The href of a route; defaults (page 1, 30 days, no search, open reports, every chapter) are left out. */
export function routeHref(route: Route): string {
  const page = (p: number | undefined) => (p && p > 1 ? p : undefined);
  const days = (d: number | undefined) => (d && d !== DEFAULT_DAYS ? d : undefined);
  switch (route.name) {
    case 'overview':
      return withQuery('#/overview', { days: days(route.days) });
    case 'screens':
      return withQuery('#/screens', { days: days(route.days) });
    case 'levels':
      return withQuery('#/levels', {
        days: days(route.days),
        chapter: route.chapter || undefined,
        allRevs: route.allRevs ? 1 : undefined,
      });
    case 'installs':
      return withQuery('#/installs', { search: route.search, page: page(route.page) });
    case 'users':
      return withQuery('#/users', { search: route.search, page: page(route.page) });
    case 'games':
      return withQuery('#/games', { mode: route.mode, search: route.search, page: page(route.page) });
    case 'reports':
      return withQuery('#/reports', {
        status: route.status === DEFAULT_REPORT_FILTER ? undefined : route.status,
        page: page(route.page),
      });
    case 'audit':
      return withQuery('#/audit', { page: page(route.page) });
    case 'install':
      return `#/installs/${encodeURIComponent(route.id)}`;
    case 'user':
      return `#/users/${encodeURIComponent(route.id)}`;
    case 'game':
      return `#/games/${encodeURIComponent(route.id)}`;
    case 'notFound':
      return '#/overview';
  }
}

/** Goes to an href from routeHref(); Back returns from it. */
export function goTo(href: string): void {
  window.location.hash = href;
}

export function navigate(route: Route): void {
  goTo(routeHref(route));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = () => window.location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash, () => '');
  return useMemo(() => parseRoute(hash), [hash]);
}
