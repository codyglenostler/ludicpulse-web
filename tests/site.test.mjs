import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const pagePaths = [
  'index.html',
  'pulse/index.html',
  'hub/index.html',
  'support/index.html',
  'privacy/index.html',
  'terms/index.html',
  'beta/index.html',
  'beta/thanks/index.html',
];

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function localTarget(pagePath, value) {
  if (/^(?:https?:|mailto:|tel:|data:|#)/.test(value)) return null;
  const clean = value.split('#')[0].split('?')[0];
  if (!clean) return null;
  const target = clean.startsWith('/')
    ? join(root, clean)
    : resolve(root, dirname(pagePath), clean);
  return clean.endsWith('/') ? join(target, 'index.html') : target;
}

test('header-capable production policy protects every public response', () => {
  const config = JSON.parse(read('vercel.json'));
  const headers = Object.fromEntries(config.headers[0].headers.map((header) => [
    header.key, header.value,
  ]));
  assert.match(headers['Strict-Transport-Security'], /max-age=31536000/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(headers['Content-Security-Policy'], /worker-src 'self' blob:/);
  assert.doesNotMatch(headers['Content-Security-Policy'], /script-src[^;]*'unsafe-inline'/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  for (const sensitiveSource of ['/eta/(.*)', '/auth/tesla/callback/(.*)']) {
    const policy = config.headers.find((entry) => entry.source === sensitiveSource);
    assert.ok(policy, sensitiveSource);
    assert.deepEqual(policy.headers, [{ key: 'Referrer-Policy', value: 'no-referrer' }]);
  }
  for (const page of ['index.html', 'pulse/index.html', 'hub/index.html', 'beta/index.html']) {
    assert.doesNotMatch(read(page), /<script>document\.documentElement/u);
  }
});

test('homepage leads directly with Ludic Pulse', () => {
  const html = read('index.html');
  const main = html.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
  assert.match(main, /Every drive\. Every charge\. Anytime\./);
  assert.match(html, /Ludic Pulse/);
  assert.doesNotMatch(main, /Ludic Hub|Products/);
  assert.match(html, /not affiliated with, endorsed by, or sponsored by Tesla/);
});

test('Pulse route remains available without duplicate homepage messaging', () => {
  const html = read('pulse/index.html');
  assert.match(html, /Every drive\. Every charge\. Anytime\./);
  assert.match(html, /Tesla’s authorization flow/);
  assert.match(html, /Shared ETA/);
  assert.match(html, /href="\/" aria-current="page">Pulse/);
  assert.doesNotMatch(html, /Free US beta|hardware/i);
});

test('Hub page is specific about capabilities without inventing launch facts', () => {
  const html = read('hub/index.html');
  assert.match(html, /In development/);
  assert.match(html, /automatically archive dashcam footage to your flash drive/);
  assert.match(html, /view saved footage directly from the app/);
  assert.equal((html.match(/class="hub-skeleton-canvas"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /private Wi-Fi|price, and availability|What Hub adds|planned workflow/);
  assert.doesNotMatch(html, /gap-free recording|cloud-surveillance/i);
  assert.doesNotMatch(html, /available (?:now|today)|ships? (?:now|on)|\$\d+/i);
});

test('product pages avoid repeated numbered-card marketing templates', () => {
  for (const pagePath of ['pulse/index.html', 'hub/index.html']) {
    const html = read(pagePath);
    assert.doesNotMatch(html, /capability-grid|capability-card/, pagePath);
  }
});

test('brand system uses the locked colors and exact approved wordmark asset', () => {
  const css = read('styles.css');
  assert.match(css, /--green: #21ad81;/);
  assert.match(css, /--blue: #378add;/);
  assert.ok(existsSync(join(root, 'assets/ludic-technologies-wordmark.png')));
  assert.ok(existsSync(join(root, 'social-card.png')));
});

test('Pulse walkthroughs reference current captures with proportional rendering', () => {
  const html = read('index.html');
  for (const filename of [
  "car-overview.png",
  "car-controls.png",
  "car-charging.png",
  "car-shared-eta.png",
  "charging-overview.png",
  "charging-history.png",
  "charging-session.png",
  "charging-home.png",
  "charging-battery.png",
  "charging-live-activity.png",
  "drives-overview.png",
  "drives-history.png",
  "drives-routes.png",
  "drives-correction.png",
  "drives-weekly.png",
  "drives-insights.png"
]) {
    assert.ok(existsSync(join(root, 'assets/screens/current', filename)), filename);
    assert.ok(html.includes('/assets/screens/current/' + filename), filename);
  }
  assert.doesNotMatch(html, /assets\/screens\/showcase/);
  const css = read('styles.css');
  assert.match(css, /\.workflow-carousel \.carousel-stage \{ aspect-ratio: 1206 \/ 2622;/);
  assert.match(css, /\.workflow-carousel \.carousel-screen \{ height: 100%; object-fit: contain;/);
  assert.match(read('site.js'), /dataset\.screenDescription/);
});

test('all public pages include baseline accessibility structure', () => {
  for (const pagePath of pagePaths) {
    const html = read(pagePath);
    assert.match(html, /<html lang="en">/, pagePath);
    assert.match(html, /class="skip-link" href="#main"/, pagePath);
    assert.match(html, /<main id="main"[^>]*tabindex="-1"/, pagePath);
    assert.match(html, /aria-label="Main navigation"/, pagePath);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, pagePath);
    for (const image of html.match(/<img\b[^>]*>/g) ?? []) {
      assert.match(image, /\balt="[^"]*"/, `${pagePath}: ${image}`);
    }
  }
});

test('public HTML never displays or advertises the Pulse app icon', () => {
  const publicPages = [...pagePaths, 'eta/index.html', 'auth/tesla/callback/index.html'];
  for (const pagePath of publicPages) {
    assert.doesNotMatch(read(pagePath), /(?:icon|favicon)\.png/i, pagePath);
  }
});

test('local links and assets referenced by company pages resolve', () => {
  for (const pagePath of pagePaths) {
    const html = read(pagePath);
    const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
    for (const reference of references) {
      const target = localTarget(pagePath, reference);
      if (!target) continue;
      assert.ok(existsSync(target), `${pagePath}: missing ${reference}`);
    }
  }
});

test('legal, support, beta, Tesla, and Shared ETA routes remain present', () => {
  const required = [
    'pulse/index.html',
    'support/index.html',
    'privacy/index.html',
    'terms/index.html',
    'eta/index.html',
    'beta/index.html',
    'beta/thanks/index.html',
    'analytics.js',
    '.well-known/appspecific/com.tesla.3p.public-key.pem',
    'CNAME',
  ];
  for (const relativePath of required) {
    assert.ok(existsSync(join(root, relativePath)), relativePath);
  }
});

test('anonymous analytics covers marketing pages but never sensitive public flows', () => {
  for (const pagePath of pagePaths) {
    assert.match(read(pagePath), /src="\/analytics\.js\?v=20260901-pageview-v1"/, pagePath);
  }
  for (const pagePath of ['eta/index.html', 'auth/tesla/callback/index.html']) {
    assert.doesNotMatch(read(pagePath), /analytics\.js|vercel\/insights/i, pagePath);
  }
  const script = read('analytics.js');
  assert.match(script, /\/_vercel\/insights\/script\.js/);
  assert.match(script, /'localhost', '127\.0\.0\.1', '::1'/);
  assert.doesNotMatch(script, /email|formData|localStorage|sessionStorage|cookie/i);
});

test('launch and conversion paths are measurable without custom events', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(config.redirects, [{
    source: '/teaser', destination: '/teaser/', permanent: false,
  }]);
  assert.deepEqual(config.rewrites, [{
    source: '/teaser/', destination: '/index.html',
  }]);
  assert.match(read('site.js'), /window\.location\.assign\('\/beta\/thanks\/'\)/);
});
