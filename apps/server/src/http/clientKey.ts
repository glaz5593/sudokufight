import { isIPv4, isIPv6 } from 'node:net';

/**
 * The key a per-client rate limit counts under (POST /v1/events per IP, admin sign-in): req.ip, but
 * - an IPv4 address written as IPv6 (`::ffff:1.2.3.4`) is that IPv4 address, and
 * - an IPv6 address counts as its /64 network. One subscriber (a home, a phone) gets a whole /64 and may use
 *   any of its 2^64 addresses, so counting single addresses would let one client step around every limit,
 *   the admin's 5 sign-in tries a minute included.
 */
export function clientKey(ip: string | undefined): string {
  if (ip === undefined || ip === '') return 'unknown';
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)?.[1];
  if (v4 !== undefined && isIPv4(v4)) return v4;
  const groups = isIPv6(ip) ? ipv6Groups(ip) : null;
  return groups === null ? ip : `${groups.slice(0, 4).join(':')}::/64`;
}

/** The 8 groups of a valid IPv6 address, as lower-case hex without leading zeros. */
function ipv6Groups(ip: string): string[] | null {
  let addr = ip.split('%')[0] ?? ''; // without a zone (fe80::1%eth0)
  // A dotted IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) is the last two groups.
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (tail !== null) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    addr = `${addr.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = addr.split('::');
  const head = halves[0] === '' || halves[0] === undefined ? [] : halves[0].split(':');
  const rest = halves.length < 2 || halves[1] === '' ? [] : (halves[1] ?? '').split(':');
  const missing = 8 - head.length - rest.length;
  if (halves.length > 2 || (halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
  return groups.map((g) => parseInt(g, 16).toString(16));
}
