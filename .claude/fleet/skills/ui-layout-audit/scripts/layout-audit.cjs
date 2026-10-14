#!/usr/bin/env node
'use strict';
// Layout audit: DOM geometry checks at several viewports. Read-only, no side effects on the page.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const args = process.argv.slice(2);
const url = args.find((a) => /^https?:/.test(a));
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
if (!url) { console.error('usage: layout-audit.cjs <url> [--viewports 390x844,1024x800,1400x900,1700x900] [--out report.json] [--shots dir]'); process.exit(2); }
const viewports = opt('viewports', '390x844,1024x800,1400x900,1700x900').split(',').map((s) => s.split('x').map(Number));
function findPlaywright() {
  const cand = [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean);
  for (const c of cand) { try { return require(c); } catch {} }
  throw new Error('playwright module not found; set PLAYWRIGHT_MODULE');
}
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell')).sort().reverse() : [];
  for (const d of dirs) {
    for (const sub of fs.readdirSync(path.join(root, d))) {
      const exe = path.join(root, d, sub, 'chrome-headless-shell');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}
// runs inside the page
function audit() {
  const out = [];
  const sel = (e) => e.id ? '#' + e.id : (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''));
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top + scrollY, r: r.right, b: r.bottom + scrollY, w: r.width, h: r.height }; };
  const srOnly = (e) => { for (let p = e; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(s.clip) || (s.position === 'absolute' && p.getBoundingClientRect().width <= 2 && p.getBoundingClientRect().height <= 2)) return true; } return false; };
  const visible = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 4 && r.height > 4 && !srOnly(e); };
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: 'overflow-x', sel: 'html', scrollWidth: document.documentElement.scrollWidth, innerWidth });
  // containers: grid/flex parents with >=2 visible children
  for (const p of document.querySelectorAll('body, body *')) {
    const cs = getComputedStyle(p);
    if (!/grid|flex|block/.test(cs.display) || !visible(p)) continue;
    const kids = [...p.children].filter((k) => visible(k) && getComputedStyle(k).position !== 'absolute' && getComputedStyle(k).position !== 'fixed');
    if (kids.length < 2) continue;
    const gapPx = parseFloat(cs.rowGap) || 0;
    const rects = kids.map((k) => ({ k, ...R(k) }));
    // vertical gaps within the same column (horizontal overlap > 50% of the narrower)
    for (const a of rects) for (const b of rects) {
      if (a === b || b.t < a.b - 1) continue;
      const ov = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      if (ov < 0.5 * Math.min(a.w, b.w)) continue;
      // b must be the next block below a in that column
      const between = rects.some((c) => c !== a && c !== b && c.t >= a.b - 1 && c.b <= b.t + 1 && Math.min(a.r, c.r) - Math.max(a.l, c.l) > 0.5 * Math.min(a.w, c.w));
      if (between) continue;
      const gap = b.t - a.b;
      if (gap > Math.max(32, 3 * gapPx)) out.push({ kind: 'gap', sel: sel(a.k) + ' -> ' + sel(b.k), parent: sel(p), gapPx: Math.round(gap), rowGap: Math.round(gapPx) });
    }
    // two-column imbalance
    if (/grid/.test(cs.display) && cs.gridTemplateColumns.split(' ').length >= 2) {
      const mid = (Math.min(...rects.map((x) => x.l)) + Math.max(...rects.map((x) => x.r))) / 2;
      const left = rects.filter((x) => (x.l + x.r) / 2 < mid), right = rects.filter((x) => (x.l + x.r) / 2 >= mid);
      if (left.length && right.length) {
        const h = (arr) => Math.max(...arr.map((x) => x.b)) - Math.min(...arr.map((x) => x.t));
        const hl = h(left), hr = h(right);
        if (Math.min(hl, hr) < 0.5 * Math.max(hl, hr) && Math.max(hl, hr) - Math.min(hl, hr) > 200)
          out.push({ kind: 'unbalanced', sel: sel(p), shorterColumn: hl < hr ? 'left' : 'right', heights: [Math.round(hl), Math.round(hr)] });
      }
    }
  }
  // media narrower than the wrapper: side strips
  for (const m of document.querySelectorAll('canvas, img, svg')) {
    const w = m.parentElement; if (!w || !visible(m)) continue;
    const a = R(m), b = R(w); const cs = getComputedStyle(w);
    const innerL = b.l + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), innerR = b.r - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const free = innerR - innerL - a.w; if (a.w < 80 || free < 16) continue;
    const left = a.l - innerL, right = innerR - a.r;
    if (Math.abs(left - right) > 16 || (left > 40 && right > 40)) out.push({ kind: 'strip', sel: sel(m), wrapper: sel(w), left: Math.round(left), right: Math.round(right) });
  }
  // overlapping / clipped text
  const leaves = [...document.querySelectorAll('body *')].filter((e) => visible(e) && e.children.length === 0 && (e.textContent || '').trim().length > 1 && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE').slice(0, 500);
  const rs = leaves.map((e) => ({ e, ...R(e) }));
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (ox <= 0 || oy <= 0) continue;
    if (ox * oy > 0.3 * Math.min(a.w * a.h, b.w * b.h)) out.push({ kind: 'overlap', a: sel(a.e) + ':' + a.e.textContent.trim().slice(0, 20), b: sel(b.e) + ':' + b.e.textContent.trim().slice(0, 20) });
  }
  for (const x of rs) { const cs = getComputedStyle(x.e); if (/hidden|clip/.test(cs.overflowX) && x.e.scrollWidth > x.e.clientWidth + 1 && !/ellipsis/.test(cs.textOverflow)) out.push({ kind: 'clipped', sel: sel(x.e), text: x.e.textContent.trim().slice(0, 30), scrollWidth: x.e.scrollWidth, clientWidth: x.e.clientWidth }); }
  return out;
}
(async () => {
  const pw = findPlaywright();
  const browser = await pw.chromium.launch({ executablePath: findChromium() });
  const report = { url, at: new Date().toISOString(), viewports: [] };
  const shots = opt('shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1500);
    const findings = await page.evaluate(audit);
    if (shots) await page.screenshot({ path: path.join(shots, `layout-${w}x${h}.png`), fullPage: false });
    report.viewports.push({ viewport: `${w}x${h}`, findings });
    await page.close();
  }
  await browser.close();
  const total = report.viewports.reduce((n, v) => n + v.findings.length, 0);
  for (const v of report.viewports) console.log(`${v.viewport}: ${v.findings.length} finding(s)` + v.findings.slice(0, 6).map((f) => '\n  - ' + JSON.stringify(f)).join(''));
  console.log(total === 0 ? 'RESULT: CLEAN (heuristic; viewports above only)' : `RESULT: ${total} finding(s), confirm each by eye before changing the design`);
  if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(report, null, 2));
  process.exit(total === 0 ? 0 : 1);
})().catch((e) => { console.error('audit failed:', e.message); process.exit(3); });
