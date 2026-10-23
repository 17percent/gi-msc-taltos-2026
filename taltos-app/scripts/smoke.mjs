// A WP0 „kész”-kritériumának füstpróbája egy futó példányon: a frontend és a backend válaszol,
// és mindkét WebSocket-útvonal eléri a backend session-kapuját (WP2: session nélkül 401). Használat: node scripts/smoke.mjs [alap-URL]
import http from 'node:http';
import https from 'node:https';

const base = new URL(process.argv[2] ?? 'http://localhost:8080');
const origin = base.origin;
let failed = false;

async function check(name, run) {
  try {
    console.log(`OK    ${name}: ${await run()}`);
  } catch (error) {
    failed = true;
    console.log(`HIBA  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function get(path, expectType) {
  const response = await fetch(new URL(path, base));
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!type.includes(expectType)) throw new Error(`váratlan content-type: ${type}`);
  return `HTTP ${response.status}`;
}

// Az upgrade-et a WP2 óta munkamenet-kapu védi: session nélkül 401 jár. A 401 Problem Details bizonyítja, hogy a
// kérés az nginx-en át a backend upgrade-kapujáig ért (a proxy továbbítja az Upgrade-et és az Origin-t).
function probeSocket(path) {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        origin,
      },
      timeout: 5000,
    });
    request.on('response', (response) => {
      response.resume();
      const type = response.headers['content-type'] ?? '';
      if (response.statusCode === 401 && type.includes('problem+json'))
        resolve('401 session nélkül (a kapu él)');
      else reject(new Error(`HTTP ${response.statusCode}, ${type}`));
    });
    request.on('upgrade', () => reject(new Error('session nélkül megnyílt az upgrade')));
    request.on('timeout', () => request.destroy(new Error('időtúllépés')));
    request.on('error', reject);
    request.end();
  });
}

await check('frontend /', () => get('/', 'text/html'));
await check('backend /healthz', () => get('/healthz', 'application/json'));
await check('WebSocket /collab', () => probeSocket('/collab'));
await check('WebSocket /ws/notifications', () => probeSocket('/ws/notifications'));

process.exit(failed ? 1 : 0);
