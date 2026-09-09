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
  assert.match(privacy, /Effective September 9, 2026/);
  assert.match(privacy, /up to eight enabled schedule locations/);
  assert.match(privacy, /Connectivity loss alone is not treated as sleep/);
});

function wordCount(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

test('root page is the complete Pulse landing page', () => {
  const main = mainMarkup(read('index.html'));
  assert.equal((main.match(/<section\b/g) ?? []).length, 2);
  assert.ok(wordCount(main) <= 260, `homepage has ${wordCount(main)} words`);
  assert.match(main, /Every drive\. Every charge\. Anytime\./);
  assert.match(main, /data-screen-carousel/);
  assert.equal((main.match(/class="carousel-screen/g) ?? []).length, 10);
  assert.doesNotMatch(main, /Products|optional hardware|Free US beta/i);
});

test('Pulse ends with a concise local-data privacy statement', () => {
  const main = mainMarkup(read('index.html'));
  const privacy = main.match(/<section class="hub-status[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.doesNotMatch(main, /screen-gallery-section|screen-reel/);
  assert.doesNotMatch(privacy, /Built around your data|Read the privacy policy/);
  assert.match(privacy, /personal data is stored locally for data privacy and integrity\./);
  assert.doesNotMatch(privacy, /Join the private beta/);
});

test('legacy Pulse route mirrors the root landing page', () => {
  const main = mainMarkup(read('pulse/index.html'));
  assert.equal(read('pulse/index.html'), read('index.html'));
  assert.match(main, /confirmed physical change/);
  assert.match(main, /Drive history/);
  assert.match(main, /Charging Live Activity/);
  assert.match(main, /Shared ETA/);
  assert.doesNotMatch(main, /hardware/i);
});

test('Inside the app fills the hero with four single-row product areas', () => {
  const main = mainMarkup(read('index.html'));
  const inside = main.match(/<div id="inside-pulse"[\s\S]*?<div class="inside-beta-action">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
  assert.match(inside, /Inside the app/);
  assert.equal((inside.match(/class="feature-row"/g) ?? []).length, 4);
  for (const area of ['Car', 'Drives', 'Charging', 'Shared ETA']) assert.match(inside, new RegExp(`<dt>${area}<\\/dt>`));
  assert.match(inside, /longer-term patterns/);
  assert.match(inside, /Live Activity progress on the Lock Screen/);
  assert.match(inside, /opens in any browser\. No app or sign-in required\./);
  assert.doesNotMatch(inside, /—/);
  assert.match(inside, /<\/dl>\s*<div class="inside-beta-action"><a class="button button-primary" href="\/beta\/">Join the private beta<\/a><\/div>/);
  assert.doesNotMatch(main, /The full picture, without the noise|hero-actions/);
});

test('Shared ETA carousel sequence shows the message thread before the recipient route', () => {
  const main = mainMarkup(read('index.html'));
  assert.match(main, /data-screen-title="ETA message thread" src="\/assets\/screens\/showcase\/06-share-eta-message\.png"[\s\S]*data-screen-title="Recipient route" src="\/assets\/screens\/showcase\/07-recipient-eta\.png"/);
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
