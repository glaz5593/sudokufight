import { clientKey } from './clientKey';

describe('clientKey (what a per-IP rate limit counts under)', () => {
  it('an IPv4 address is itself, also when Node writes it as IPv6', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('an IPv6 address counts as its /64: one subscriber cannot rotate around the limit', () => {
    const key = '2001:db8:1:2::/64';
    expect(clientKey('2001:db8:1:2::1')).toBe(key);
    expect(clientKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(key);
    expect(clientKey('2001:0DB8:0001:0002:0:0:0:abcd')).toBe(key);
    expect(clientKey('2001:db8:1:2::1%eth0')).toBe(key);
    // The neighbouring /64 is someone else.
    expect(clientKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
  });

  it('expands :: anywhere, and a dotted tail', () => {
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('::')).toBe('0:0:0:0::/64');
    expect(clientKey('fe80::')).toBe('fe80:0:0:0::/64');
    expect(clientKey('1::2:3:4:5:6:7')).toBe('1:0:2:3::/64');
    expect(clientKey('64:ff9b::192.0.2.33')).toBe('64:ff9b:0:0::/64');
  });

  it('anything else is kept as it is; no address at all is "unknown"', () => {
    expect(clientKey(undefined)).toBe('unknown');
    expect(clientKey('')).toBe('unknown');
    expect(clientKey('not an ip')).toBe('not an ip');
  });
});
