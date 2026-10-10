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
    ];
    for (const route of routes) {
      expect(parseRoute(routeHref(route))).toMatchObject(route);
    }
    expect(routeHref({ name: 'users', search: '', page: 1 })).toBe('#/users');
    expect(routeHref({ name: 'overview', days: 30 })).toBe('#/overview');
  });

  it('maps detail pages to their nav section', () => {
    expect(sectionOf({ name: 'install', id: 'x' })).toBe('installs');
    expect(sectionOf({ name: 'game', id: 'x' })).toBe('games');
    expect(sectionOf({ name: 'notFound' })).toBeNull();
  });
});
