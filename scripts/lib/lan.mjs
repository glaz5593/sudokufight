/**
 * The pure parts of `npm run dev:lan` (scripts/dev-lan.mjs): which of the PC's addresses the phones should use,
 * the command line, the apps/mobile/.env.local lines, and what to print. No I/O here, so the tests
 * (apps/server/test/devLan.test.ts) run them on made-up data; types in lan.d.mts.
 */

/** The dev server's port (apps/server/src/config.ts DEFAULT_PORT). */
export const DEFAULT_PORT = 2567;
/** Metro (the JS bundle of the Development Build). */
export const METRO_PORT = 8081;
/**
 * The admin site's password in development with the local PGlite and no ADMIN_PASSWORD (apps/server/src/config.ts
 * DEV_ADMIN_PASSWORD; the tests check they are the same).
 */
export const DEV_ADMIN_PASSWORD = 'sudoku-admin-dev';

// ---------------------------------------------------------------- the LAN address

/**
 * Adapters that are not the network the phones are on: Hyper-V and WSL (vEthernet), VirtualBox, VMware,
 * Docker, VPNs and tunnels, Bluetooth, and macOS's AirDrop / bridges.
 */
const VIRTUAL_NAME =
  /vethernet|\bwsl\b|hyper-?v|virtualbox|\bvbox|vmware|vmnet|docker|^br-|^veth|virbr|loopback|^lo\d*$|bluetooth|tailscale|zerotier|^zt|wireguard|^wg\d|^tun\d|^tap|^utun|nordlynx|openvpn|\bvpn\b|hamachi|radmin|^ppp|npcap|^awdl|^llw|^bridge|^anpi|forticlient|anyconnect|globalprotect|pangp|cisco/i;

/**
 * Virtual adapters by their MAC's vendor (OUI), for those with ordinary names ("Ethernet 3" is often a VPN's TAP
 * adapter): Hyper-V, VirtualBox, VMware, Docker's bridges, TAP-Windows.
 */
const VIRTUAL_MAC = /^(00:15:5d|08:00:27|0a:00:27|00:05:69|00:0c:29|00:1c:14|00:50:56|02:42:|00:ff:)/i;

const WIFI_NAME = /wi-?fi|wlan|wireless|^wl|airport/i;
const ETHERNET_NAME = /ethernet|^eth\d|^en[opsx]?\d|local area connection|^lan\b/i;

/** @param {string} address */
export function isIPv4(address) {
  const parts = address.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && String(Number(p)) === p)
  );
}

/** Home and office networks first, then other private ranges, then the rest (0 is best). */
function rangeRank(address) {
  const [a, b] = address.split('.').map(Number);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  // 100.64.0.0/10 is carrier-grade NAT, and what Tailscale hands out.
  if (a === 100 && b >= 64 && b <= 127) return 4;
  return 3;
}

/**
 * Every IPv4 address of the PC that a phone could reach, best first: real adapters before virtual ones, Wi-Fi
 * before Ethernet before anything else, 192.168.x before 10.x before 172.16–31.x. Loopback, internal and
 * link-local (169.254.x: no DHCP answer) addresses are left out.
 *
 * @param {Record<string, readonly { address: string; family: string | number; internal: boolean; mac?: string }[] | undefined>} interfaces
 *   os.networkInterfaces()
 */
export function lanCandidates(interfaces) {
  const found = [];
  let order = 0;
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const info of addresses ?? []) {
      // Node 18.0–18.3 said 4, later versions 'IPv4'.
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      if (info.internal || !isIPv4(info.address)) continue;
      if (info.address.startsWith('127.') || info.address.startsWith('169.254.')) continue;
      const kind = WIFI_NAME.test(name) ? 'wifi' : ETHERNET_NAME.test(name) ? 'ethernet' : 'other';
      const virtual = VIRTUAL_NAME.test(name) || VIRTUAL_MAC.test(info.mac ?? '');
      found.push({ name, address: info.address, kind, virtual, order: order++ });
    }
  }
  const kindRank = { wifi: 0, ethernet: 1, other: 2 };
  found.sort(
    (x, y) =>
      Number(x.virtual) - Number(y.virtual) ||
      kindRank[x.kind] - kindRank[y.kind] ||
      rangeRank(x.address) - rangeRank(y.address) ||
      x.order - y.order,
  );
  return found.map(({ name, address, kind, virtual }) => ({ name, address, kind, virtual }));
}

/** The address the phones should use, or null when the PC has only virtual adapters (or none). */
export function pickLanAddress(interfaces) {
  return lanCandidates(interfaces).find((c) => !c.virtual) ?? null;
}

// ---------------------------------------------------------------- the command line

export const USAGE = `npm run dev:lan [-- options]

  --ip <address>   the PC's address for the phones (default: the Wi-Fi / Ethernet adapter's IPv4)
  --port <n>       the server's port (default PORT in apps/server/.env, else ${DEFAULT_PORT})
  --seed           sample data for the admin site first (npm run seed; once, it keeps what is there)
  --write-env      write the server's address into apps/mobile/.env.local (gitignored)
  --no-server      print the details only (the server is running elsewhere): no seeding, no start
  --help           this text`;

/**
 * @param {readonly string[]} argv process.argv.slice(2)
 */
export function parseDevLanArgs(argv) {
  const options = { ip: null, port: null, seed: false, writeEnv: false, server: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const [flag, inline] =
      arg.startsWith('--') && eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, null];
    const value = () => {
      if (inline !== null) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i++;
      return next;
    };
    switch (flag) {
      case '--help':
      case '-h':
        return { kind: 'help' };
      case '--seed':
      case '--write-env':
      case '--no-server':
        if (inline !== null) return { kind: 'error', error: `${flag} takes no value` };
        if (flag === '--seed') options.seed = true;
        else if (flag === '--write-env') options.writeEnv = true;
        else options.server = false;
        break;
      case '--ip': {
        const ip = value();
        if (ip === null || !isIPv4(ip))
          return { kind: 'error', error: `--ip needs an IPv4 address, e.g. 192.168.1.20` };
        options.ip = ip;
        break;
      }
      case '--port': {
        const port = value();
        const n = Number(port);
        if (port === null || !/^\d+$/.test(port) || n < 1 || n > 65535)
          return { kind: 'error', error: '--port needs a number from 1 to 65535' };
        options.port = n;
        break;
      }
      default:
        return { kind: 'error', error: `unknown option ${arg}` };
    }
  }
  if (!options.server && options.seed)
    return {
      kind: 'error',
      error: '--seed needs the server stopped: drop --no-server (dev:lan starts it after)',
    };
  return { kind: 'options', options };
}

// ---------------------------------------------------------------- apps/mobile/.env.local

/** The three lines that point the app at the dev server. */
export function serverEnv(host, port) {
  return {
    EXPO_PUBLIC_SERVER_HOST: host,
    EXPO_PUBLIC_SERVER_PORT: String(port),
    EXPO_PUBLIC_SERVER_SECURE: 'false',
  };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * apps/mobile/.env.local with these values: each key's (uncommented) line replaced in place, or added at the
 * end; every other line, comments and line endings as they were. A new file starts from .env.example.
 *
 * @param {string | null} current the file now, or null when there is none
 * @param {Record<string, string>} values
 * @param {string | null} template apps/mobile/.env.example, for a new file
 * @returns {{ text: string; changed: boolean }}
 */
export function updateEnvText(current, values, template) {
  let text = current ?? template ?? '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const added = [];
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^([ \\t]*(?:export[ \\t]+)?${escapeRe(key)}[ \\t]*=)[^\\r\\n]*$`, 'm');
    if (line.test(text)) text = text.replace(line, () => `${key}=${value}`);
    else added.push(`${key}=${value}`);
  }
  if (added.length > 0) {
    if (text !== '' && !text.endsWith('\n')) text += eol;
    text += added.join(eol) + eol;
  }
  return { text, changed: text !== current };
}

// ---------------------------------------------------------------- what to print

/** Windows' own rules for node.exe that block it (made when its firewall prompt was cancelled). */
const NODE_BLOCK_RULES = 'Get-NetFirewallRule -DisplayName "*Node.js*" | Where-Object Action -eq Block';

/** The Windows Firewall rule (PowerShell as administrator) that lets the phones in on `port`, private networks only. */
export function firewallCommand(port, what) {
  return (
    `New-NetFirewallRule -DisplayName "Sudoku Fight ${what} (TCP ${port})" -Direction Inbound -Action Allow ` +
    `-Protocol TCP -LocalPort ${port} -Profile Private`
  );
}

/**
 * The lines dev:lan prints once the server answers (Hebrew; values and commands on lines of their own, which
 * a terminal without bidi still shows the right way round).
 *
 * @param {{
 *   host: string;
 *   port: number;
 *   adapter: string | null;
 *   others: readonly { name: string; address: string }[];
 *   admin: { kind: 'dev' } | { kind: 'env' } | { kind: 'off' };
 *   adminBuilt: boolean;
 *   envFile: { changed: boolean } | null;
 *   lanCheck: 'ok' | 'failed' | 'skipped';
 *   platform: string;
 *   serverStarted: boolean;
 * }} info
 */
export function bannerLines(info) {
  const { host, port } = info;
  const base = `http://${host}:${port}`;
  const env = serverEnv(host, port);
  const rule = '='.repeat(72);
  const lines = [
    '',
    rule,
    'סודוקו פייט: שרת פיתוח לטלפונים ברשת המקומית',
    rule,
    '',
    `כתובת השרת${info.adapter ? ` (המתאם "${info.adapter}")` : ''}:`,
    `  ${base}`,
    'בדיקה מהטלפון: פותחים בדפדפן של הטלפון את הכתובת הזאת. צריך לראות {"ok":true,...}',
    `  ${base}/health`,
  ];
  if (info.lanCheck === 'ok') lines.push('  (מהמחשב עצמו השרת עונה בכתובת הזאת)');
  if (info.lanCheck === 'failed')
    lines.push('!! השרת לא ענה בכתובת הזאת גם מהמחשב עצמו. אולי זו לא הכתובת הנכונה: בוחרים אחרת עם --ip');
  if (info.others.length > 0) {
    lines.push('כתובות אחרות של המחשב (אם הטלפון לא מגיע לשרת, מנסים אחת מהן עם --ip):');
    for (const o of info.others) lines.push(`  ${o.address}   (${o.name})`);
  }

  lines.push('', 'האפליקציה: הקובץ', '  apps/mobile/.env.local');
  if (info.envFile) lines.push(info.envFile.changed ? '  עודכן. אלה השורות:' : '  כבר מעודכן. אלה השורות:');
  else lines.push('  צריך את השורות האלה (או מריצים שוב עם --write-env, והן נכתבות לבד):');
  for (const [key, value] of Object.entries(env)) lines.push(`    ${key}=${value}`);
  lines.push(
    'אחרי כל שינוי בקובץ מפעילים מחדש את Metro עם ניקוי, כי הכתובת נכנסת ל־bundle:',
    '  npm run mobile -- --clear',
    'אם Metro מציע לטלפון כתובת אחרת, בחלון של Metro (PowerShell):',
    `  $env:REACT_NATIVE_PACKAGER_HOSTNAME="${host}"; npm run mobile -- --clear`,
    'כדי לוודא באפליקציה: בבית, בשורה "פיתוח" בתחתית ← "משחק מקוון". שם מופיעה כתובת השרת.',
  );

  lines.push('', 'אתר הניהול:', `  ${base}/admin`);
  if (info.admin.kind === 'dev') lines.push('  סיסמת הפיתוח:', `    ${DEV_ADMIN_PASSWORD}`);
  else if (info.admin.kind === 'env') lines.push('  הסיסמה: ADMIN_PASSWORD מ־apps/server/.env');
  else lines.push('  כבוי: עם DATABASE_URL צריך ADMIN_PASSWORD ב־apps/server/.env');
  if (!info.adminBuilt) lines.push('  האתר עוד לא נבנה. פעם אחת, בחלון אחר:', '    npm run admin:build');

  if (info.platform === 'win32') {
    lines.push(
      '',
      'Windows Firewall: אם הטלפון לא מגיע ל־/health',
      '  1. רשת ה־Wi-Fi צריכה להיות "פרטית" (Private). בודקים ב־PowerShell:',
      '       Get-NetConnectionProfile',
      '     אם כתוב Public, ב־PowerShell כמנהל (Run as administrator):',
      `       Set-NetConnectionProfile -InterfaceAlias "${info.adapter ?? 'Wi-Fi'}" -NetworkCategory Private`,
      '  2. כשמופיע החלון של Windows על Node.js, מאשרים גישה ברשתות פרטיות.',
      `  3. או כלל שמאפשר את פורט ${port}, ב־PowerShell כמנהל (פעם אחת):`,
      `       ${firewallCommand(port, 'dev server')}`,
      `     ול־Metro (פורט ${METRO_PORT}), אם הטלפון לא טוען את האפליקציה בלי כבל:`,
      `       ${firewallCommand(METRO_PORT, 'Metro')}`,
      '  4. אם פעם נלחץ "ביטול" בחלון של Node.js, נוצר כלל חוסם שגובר על כל היתר. כך רואים אותו:',
      `       ${NODE_BLOCK_RULES}`,
      '     וכך מוחקים אותו (כמנהל):',
      `       ${NODE_BLOCK_RULES} | Remove-NetFirewallRule`,
    );
  }

  // fake-client talks to ws://localhost:${DEFAULT_PORT} unless told otherwise.
  const url = port === DEFAULT_PORT ? '' : ` --url ws://localhost:${port}`;
  lines.push(
    '',
    'יריבים מזויפים (בחלון אחר, מהשורש):',
    '  משחק מדורג: בטלפון "שחק" ← "מדורג · 2 שחקנים" ← "מהיר" ← "מצא יריב", ובמחשב:',
    `    npm run fake-client -- --queue fast-2p --name Ana --speed 20${url}`,
    '  משחק של 4: שני טלפונים בתור fast-4p, ושני לקוחות מזויפים, כל אחד בחלון משלו',
    `    npm run fake-client -- --queue fast-4p --name Cyd --speed 20${url}`,
    `    npm run fake-client -- --queue fast-4p --name Dov --speed 20${url}`,
    '  חדר פרטי: הלקוח המזויף יוצר חדר ומדפיס את הקוד שלו, ומצטרפים אליו מהטלפון ("משחק מקוון")',
    `    npm run fake-client -- --create --name Fake1${url}`,
  );
  if (info.serverStarted) lines.push('', 'עוצרים את השרת עם Ctrl+C.');
  lines.push(rule, '');
  return lines;
}
