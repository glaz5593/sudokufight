import postgres from 'postgres';

import { driverUrl } from './url';

const NEON = 'postgresql://user:p%40ss@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb';

describe('driverUrl', () => {
  it("drops Neon's channel_binding and keeps sslmode", () => {
    expect(driverUrl(`${NEON}?sslmode=require&channel_binding=require`)).toBe(`${NEON}?sslmode=require`);
    expect(driverUrl(`${NEON}?channel_binding=require&sslmode=require`)).toBe(`${NEON}?sslmode=require`);
  });

  it('drops the query entirely when nothing else is left', () => {
    expect(driverUrl(`${NEON}?channel_binding=require&gssencmode=disable`)).toBe(NEON);
  });

  it('leaves a string without libpq-only parameters untouched', () => {
    for (const url of [NEON, `${NEON}?sslmode=require`, `${NEON}?sslmode=require&application_name=x`]) {
      expect(driverUrl(url)).toBe(url);
    }
  });

  it('keeps the password exactly as written', () => {
    expect(driverUrl(`${NEON}?sslmode=require&channel_binding=require`)).toContain('user:p%40ss@');
  });

  it('postgres.js no longer sends channel_binding to the server as a setting', () => {
    const raw = postgres(`${NEON}?sslmode=require&channel_binding=require`);
    const clean = postgres(driverUrl(`${NEON}?sslmode=require&channel_binding=require`));
    try {
      expect(raw.options.connection).toHaveProperty('channel_binding', 'require');
      expect(clean.options.connection).not.toHaveProperty('channel_binding');
      expect(clean.options.ssl).toBe('require');
    } finally {
      void raw.end();
      void clean.end();
    }
  });
});
