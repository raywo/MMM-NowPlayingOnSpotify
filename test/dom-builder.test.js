'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'translations/en.json'), 'utf8'));
// The README documents this class for styling the banner.
const STATUS_BANNER_CLASS = 'NPOS_statusBanner';
const NOTHING_PLAYING = { noSong: true };

/**
 * NPOS_DomBuilder is a browser global without module.exports, so it is run
 * as a script inside a jsdom window, as MagicMirror loads it via
 * getScripts().
 */
function loadBuilder(mirrorConfig) {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  if (mirrorConfig) {
    dom.window.config = mirrorConfig;
  }
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'core/NPOS_DomBuilder.js'), 'utf8'), context);
  const NPOS_DomBuilder = vm.runInContext('NPOS_DomBuilder', context);

  return new NPOS_DomBuilder({}, 'modules/MMM-NowPlayingOnSpotify', translate);
}

// Substitutes variables like MagicMirror's translator does.
function translate(key, variables) {
  return Object.entries(variables || {}).reduce(
    (text, [name, value]) => text.replace('{' + name + '}', value),
    TRANSLATIONS[key]);
}

function statusBanners(wrapper) {
  return wrapper.querySelectorAll('.' + STATUS_BANNER_CLASS);
}


test('a rate limit shows the time of the next attempt', () => {
  const builder = loadBuilder();
  const retryAt = new Date(2026, 9, 25, 14, 5).getTime();

  const banners = statusBanners(builder.getDom(Object.assign({ unavailable: { reason: 'RATE_LIMITED', retryAt } }, NOTHING_PLAYING)));

  assert.equal(banners.length, 1);
  assert.equal(banners[0].textContent,
    'Spotify is limiting requests – next attempt at ' + builder.formatClockTime(retryAt));
});

test('the time of the next attempt follows the mirror language', () => {
  const builder = loadBuilder({ language: 'de' });

  assert.equal(builder.formatClockTime(new Date(2026, 9, 25, 14, 5).getTime()), '14:05');
});

test('an unreachable Spotify shows the unreachable text', () => {
  const builder = loadBuilder();

  const banners = statusBanners(builder.getDom(Object.assign({ unavailable: { reason: 'UNREACHABLE', retryAt: Date.now() } }, NOTHING_PLAYING)));

  assert.equal(banners.length, 1);
  assert.equal(banners[0].textContent, 'Spotify not reachable – retrying');
});

test('a payload without unavailable renders no banner', () => {
  const builder = loadBuilder();

  assert.equal(statusBanners(builder.getDom(NOTHING_PLAYING)).length, 0);
});

test('the banner carries the documented CSS class', () => {
  const builder = loadBuilder();

  const banner = builder.getStatusBanner({ reason: 'UNREACHABLE' });

  assert.ok(banner.classList.contains(STATUS_BANNER_CLASS));
  assert.match(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), new RegExp('`\\.' + STATUS_BANNER_CLASS + '`'));
});
