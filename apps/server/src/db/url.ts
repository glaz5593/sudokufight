/**
 * Query parameters that only libpq (psql, pg_dump) understands. postgres.js sends any query parameter it does
 * not know to the server as a setting, and Postgres then refuses the connection ("unrecognized configuration
 * parameter"). Neon's "Connect" dialog adds `channel_binding=require`, so a string pasted from there as is
 * must still work: these are dropped before the driver sees them. TLS stays required through `sslmode`.
 */
export const LIBPQ_ONLY_PARAMS = ['channel_binding', 'gssencmode'] as const;

/** The connection string postgres.js gets: the same one without the libpq-only parameters. */
export function driverUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let dropped = false;
  for (const name of LIBPQ_ONLY_PARAMS) {
    if (params.has(name)) {
      params.delete(name);
      dropped = true;
    }
  }
  if (!dropped) return url;
  const rest = params.toString();
  return rest ? `${url.slice(0, q)}?${rest}` : url.slice(0, q);
}
