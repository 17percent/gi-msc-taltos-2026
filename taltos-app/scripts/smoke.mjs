// A WP0 „kész”-kritériumának füstpróbája egy futó példányon: a frontend és a backend válaszol,
// és mindkét WebSocket-útvonal fogad. Használat: node scripts/smoke.mjs [alap-URL]
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

function openSocket(path) {
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    // A Node (undici) WebSocket-je a böngészőhöz hasonlóan Origin fejlécet küld.
    const socket = new WebSocket(url, { headers: { origin } });
    const timer = setTimeout(() => reject(new Error('időtúllépés')), 5000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      socket.close();
      resolve('megnyílt');
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('a kapcsolat nem jött létre'));
    });
  });
}

await check('frontend /', () => get('/', 'text/html'));
await check('backend /healthz', () => get('/healthz', 'application/json'));
await check('WebSocket /collab', () => openSocket('/collab'));
await check('WebSocket /ws/notifications', () => openSocket('/ws/notifications'));

process.exit(failed ? 1 : 0);
