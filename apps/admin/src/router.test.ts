import { parseRoute, type Route, routeHref, sectionOf } from './router';

describe('router', () => {
  it('parses each page, with defaults', () => {
    expect(parseRoute('')).toEqual({ name: 'overview', days: 30 });
    expect(parseRoute('#/')).toEqual({ name: 'overview', days: 30 });
    expect(parseRoute('#/overview?days=7')).toEqual({ name: 'overview', days: 7 });
    expect(parseRoute('#/installs?search=pixel&page=3')).toEqual({
      name: 'installs',
      search: 'pixel',
      page: 3,
    });
    expect(parseRoute('#/users')).toEqual({ name: 'users', search: '', page: 1 });
    expect(parseRoute('#/games?mode=ranked')).toEqual({ name: 'games', mode: 'ranked', search: '', page: 1 });
    expect(parseRoute('#/screens?days=90')).toEqual({ name: 'screens', days: 90 });
    expect(parseRoute('#/installs/abc-123')).toEqual({ name: 'install', id: 'abc-123' });
    expect(parseRoute('#/users/u%2F1')).toEqual({ name: 'user', id: 'u/1' });
    expect(parseRoute('#/games/g1')).toEqual({ name: 'game', id: 'g1' });
    expect(parseRoute('#/reports')).toEqual({ name: 'reports', status: 'open', page: 1 });
    expect(parseRoute('#/reports?status=dismissed&page=2')).toEqual({
      name: 'reports',
      status: 'dismissed',
      page: 2,
    });
    expect(parseRoute('#/audit?page=4')).toEqual({ name: 'audit', page: 4 });
    expect(parseRoute('#/levels')).toEqual({ name: 'levels', days: 30, chapter: 0 });
    expect(parseRoute('#/levels?days=90')).toEqual({ name: 'levels', days: 90, chapter: 0 });
    expect(parseRoute('#/levels?chapter=4&days=7')).toEqual({ name: 'levels', days: 7, chapter: 4 });
  });

  it('the levels page (staged practice): a bad chapter is every chapter; its href round-trips', () => {
    expect(parseRoute('#/levels?chapter=x')).toMatchObject({ chapter: 0 });
    expect(parseRoute('#/levels?chapter=-1')).toMatchObject({ chapter: 0 });
    expect(parseRoute('#/levels?chapter=0')).toMatchObject({ chapter: 0 });
    expect(parseRoute('#/levels/L001')).toEqual({ name: 'notFound' });
    expect(routeHref(parseRoute('#/levels?days=90'))).toBe('#/levels?days=90');
    expect(routeHref({ name: 'levels', days: 30, chapter: 0 })).toBe('#/levels');
    expect(routeHref({ name: 'levels', days: 7, chapter: 12 })).toBe('#/levels?days=7&chapter=12');
    // 1.0.3: every rev together, only with ?allRevs=1.
    expect(parseRoute('#/levels?allRevs=1')).toEqual({ name: 'levels', days: 30, chapter: 0, allRevs: true });
    expect(parseRoute('#/levels?allRevs=yes')).toEqual({ name: 'levels', days: 30, chapter: 0 });
    expect(routeHref({ name: 'levels', days: 30, chapter: 0, allRevs: true })).toBe('#/levels?allRevs=1');
    expect(routeHref({ name: 'levels', days: 30, chapter: 0, allRevs: false })).toBe('#/levels');
    expect(sectionOf({ name: 'levels' })).toBe('levels');
  });

  it('an unknown report status is the open reports', () => {
    expect(parseRoute('#/reports?status=closed')).toEqual({ name: 'reports', status: 'open', page: 1 });
    expect(parseRoute('#/reports/x')).toEqual({ name: 'notFound' });
  });

  it('ignores bad numbers and unknown paths', () => {
    expect(parseRoute('#/installs?page=-2')).toMatchObject({ page: 1 });
    expect(parseRoute('#/installs?page=abc')).toMatchObject({ page: 1 });
    expect(parseRoute('#/overview?days=9999')).toEqual({ name: 'overview', days: 30 });
    expect(parseRoute('#/nope')).toEqual({ name: 'notFound' });
    expect(parseRoute('#/installs/a/b')).toEqual({ name: 'notFound' });
    expect(parseRoute('#/screens/x')).toEqual({ name: 'notFound' });
    expect(parseRoute('#/users/%E0%A4%A')).toEqual({ name: 'notFound' });
  });

  it('builds hrefs that parse back to the same route, leaving defaults out', () => {
    const routes: Route[] = [
      { name: 'overview', days: 7 },
      { name: 'installs', search: 'a b&c', page: 2 },
      { name: 'users', search: '', page: 1 },
      { name: 'games', mode: 'bot', search: 'pz', page: 4 },
      { name: 'install', id: 'x/y' },
      { name: 'screens', days: 30 },
      { name: 'reports', status: 'all', page: 3 },
      { name: 'reports', status: 'open', page: 1 },
      { name: 'audit', page: 2 },
      { name: 'levels', days: 90, chapter: 0 },
      { name: 'levels', days: 30, chapter: 5 },
    ];
    for (const route of routes) {
      expect(parseRoute(routeHref(route))).toMatchObject(route);
    }
    expect(routeHref({ name: 'users', search: '', page: 1 })).toBe('#/users');
    expect(routeHref({ name: 'overview', days: 30 })).toBe('#/overview');
    expect(routeHref({ name: 'reports', status: 'open', page: 1 })).toBe('#/reports');
    expect(routeHref({ name: 'reports', status: 'resolved' })).toBe('#/reports?status=resolved');
    expect(routeHref({ name: 'audit', page: 1 })).toBe('#/audit');
  });

  it('maps detail pages to their nav section', () => {
    expect(sectionOf({ name: 'install', id: 'x' })).toBe('installs');
    expect(sectionOf({ name: 'game', id: 'x' })).toBe('games');
    expect(sectionOf({ name: 'reports' })).toBe('reports');
    expect(sectionOf({ name: 'audit' })).toBe('audit');
    expect(sectionOf({ name: 'notFound' })).toBeNull();
  });
});
