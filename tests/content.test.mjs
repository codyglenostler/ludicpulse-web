import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function mainMarkup(html) {
  return html.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';
}

test('privacy discloses optional PCC interpretation, bounded payload and volatile retention', () => {
  const privacy = read('privacy/index.html');
  for (const disclosure of [
    'Optional Ask Pulse and Private Cloud Compute', 'Continue with PCC',
    'cloud processing by Apple, not on-device model processing',
    'last validated query interpretation', 'current local date and time zone',
    'fixed list of supported vehicle-feature keys',
    'does not automatically include your VIN, account or Tesla tokens, route coordinates',
    'Anything you type in your question is included', 'calculates answers on your phone',
    'does not save a chat history', 'analytics or diagnostic logs',
    'account or vehicle changes clear', 'app enters the background',
    'Cancellation cannot undo data already sent to Apple',
    'iOS 27 or later', 'eligible Apple Intelligence', 'PCC usage allowance',
    'does not wake the vehicle', 'assess whether the vehicle is safe to drive',
  ]) assert.ok(privacy.includes(disclosure), disclosure);
});

test('privacy describes the one-time factory-paint cache and its deletion boundary',()=>{
  const privacy=read('privacy/index.html');
  assert.match(privacy,/Vehicle appearance/);
  assert.match(privacy,/paint code, paint name and lookup time/);
  assert.match(privacy,/do not retain the full options response/);
  assert.match(privacy,/reused without recurring polling/);
  assert.match(privacy,/Account deletion removes your cloud factory-paint record/);
});

test('privacy describes visible charging places, shared memory reuse and provenance boundaries', () => {
  const privacy = read('privacy/index.html');
  assert.match(privacy, /Charging locations/);
  assert.match(privacy, /visible session/);
  assert.match(privacy, /limits and queues these requests/);
  assert.match(privacy, /reuses completed results across recent sessions, history, and detail/);
  assert.match(privacy, /account or vehicle context changes or you sign out/);
  assert.doesNotMatch(privacy, /when the charge view closes/);
  assert.match(privacy, /saved coordinates or full street address/);
  assert.match(privacy, /does not request your phone’s current GPS location/);
  assert.match(privacy, /short-lived in-memory cache/);
  assert.match(privacy, /does not write those results into charging history/);
  assert.match(privacy, /Effective September 30, 2026/);
  assert.match(privacy, /up to eight enabled schedule locations/);
  assert.match(privacy, /Connectivity loss alone is not treated as sleep/);
});

test('privacy distinguishes live ETA minimization from persistence and backup expiry', () => {
  const privacy = read('privacy/index.html');
  for (const text of ['keyed, per-share comparison code', 'not a readable destination name or coordinates',
    'cleared when the share ends or during expiry cleanup', 'runs at least hourly', 'separate matching key is not included in database backups',
    'not immediate physical erasure', 'requests a rewrite at least daily',
    'former readable destination comparison data', '30-day backup policy']) assert.ok(privacy.includes(text), text);
});

function wordCount(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

test('Pulse introduces three overview screens and tab walkthroughs', () => {
  const main = mainMarkup(read('index.html'));
  assert.match(main, /Every drive\. Every charge\. Anytime\./);
  for (const area of ['car', 'charging', 'drives']) {
    assert.match(main, new RegExp('href="#' + area + '"'));
    assert.match(main, new RegExp('<section id="' + area + '"'));
    assert.match(main, new RegExp('/assets/screens/current/' + area + '-overview.png'));
  }
  const sections = [...main.matchAll(/<section id="(car|charging|drives)"[\s\S]*?<\/section>/g)];
  assert.equal(sections.length, 3);
  for (const section of sections) {
    assert.match(section[0], /<h2/);
    assert.match(section[0], /<dl class="workflow-list">/);
    assert.match(section[0], /data-screen-carousel/);
    assert.match(section[0], /<figcaption[\s\S]*data-screen-description/);
    assert.match(section[0], /data-screen-previous/);
    assert.match(section[0], /data-screen-next/);
  }
  assert.doesNotMatch(main, /Automations|Hardware/i);
  assert.match(main, /sample and demo data/);
});

test('Pulse workflow copy preserves cost, location and correction boundaries', () => {
  const main = mainMarkup(read('index.html'));
  for (const disclosure of ['Unknown prices stay unknown', 'Tesla bills, entered amounts and estimates',
    'last known', 'Anyone with the link can view your live location', 'after four hours',
    'explicitly save corrections', 'Estimated capacity', 'without routes or exact locations',
    'confirmed physical change']) assert.ok(main.includes(disclosure), disclosure);
  assert.match(main, /<section id="car"[\s\S]*Shared ETA[\s\S]*<section id="charging"/);
});

test('Pulse links its accurate phone and cloud privacy explanation', () => {
  const main = mainMarkup(read('index.html'));
  assert.match(main, /stored on your phone and in cloud services/);
  assert.match(main, /href="\/privacy\/">Read how your data is handled/);
  assert.doesNotMatch(main, /personal data is stored locally for data privacy and integrity/);
  assert.match(main, /Exact route history stays off until you enable it/);
});

test('legacy Pulse route mirrors the root landing page', () => {
  assert.equal(read('pulse/index.html'), read('index.html'));
});

test('Hub stays concise and distinguishes present direction from launch facts', () => {
  const main = mainMarkup(read('hub/index.html'));
  assert.equal((main.match(/<section\b/g) ?? []).length, 3);
  assert.ok(wordCount(main) <= 240, `Hub has ${wordCount(main)} words`);
  assert.match(main, /Keep dashcam footage up to x10 longer/);
  assert.match(main, /automatically archive dashcam footage to your flash drive/);
  assert.match(main, /view saved footage directly from the app/);
  assert.match(main, /class="hub-phone-preview reveal" aria-hidden="true"/);
  assert.equal((main.match(/<section class="[^"]*hub-skeleton-section[^"]*"/g) ?? []).length, 2);
  assert.doesNotMatch(main, /Transfer|private Wi-Fi|price or release date|hub-flow|Get Hub updates|See Pulse|hub-device|system-packet|finally organized|Built locally\. Still taking shape/i);
});

test('support leads with actionable setup and omits the duplicated generated stylesheet', () => {
  const html = read('support/index.html');
  assert.match(html, /<h1>Support<\/h1>/);
  assert.match(html, /Sign in with Apple/);
  assert.match(html, /Connect Tesla/);
  assert.match(html, /Finish tracking setup/);
  assert.doesNotMatch(html, /<style>/);
});

test('legal pages keep their substantive disclosures without duplicated page CSS', () => {
  for (const pagePath of ['privacy/index.html', 'terms/index.html']) {
    const html = read(pagePath);
    assert.doesNotMatch(html, /<style>/, pagePath);
    assert.match(html, /Ludic Technologies LLC/, pagePath);
    assert.match(html, /ludictechnologiesllc@gmail\.com/, pagePath);
    assert.doesNotMatch(html, /support@ludicpulse\.com/, pagePath);
  }
});

test('primary navigation contains only the three user destinations', () => {
  for (const pagePath of ['index.html', 'pulse/index.html', 'hub/index.html', 'support/index.html', 'privacy/index.html', 'terms/index.html', 'beta/index.html']) {
    const html = read(pagePath);
    const nav = html.match(/<nav id="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
    assert.equal((nav.match(/<a\b/g) ?? []).length, 3, pagePath);
    assert.match(nav, /href="\/"[^>]*>Pulse/, pagePath);
    assert.doesNotMatch(nav, /Why Ludic|principles/, pagePath);
  }
});

test('hardware marketing stays isolated to the Hub page', () => {
  for (const pagePath of ['index.html', 'pulse/index.html', 'support/index.html',
    'privacy/index.html', 'terms/index.html', 'beta/index.html']) {
    assert.doesNotMatch(read(pagePath), /optional hardware|hardware is not required|No hardware purchase|required hardware/i, pagePath);
  }
  assert.match(read('hub/index.html'), /Ludic Hub · In development/i);
});

test('beta page stays focused on the two-field signup decision', () => {
  const main = mainMarkup(read('beta/index.html'));
  assert.equal((main.match(/<section\b/g) ?? []).length, 1);
  assert.ok(wordCount(main) <= 150, `Beta page has ${wordCount(main)} words`);
  assert.match(main, /Join the private beta/);
  assert.match(main, /name="name"/);
  assert.match(main, /name="email"/);
});
