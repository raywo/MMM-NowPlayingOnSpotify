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
// css/styles.css draws the cover's shadow on this class only.
const COVER_SHADOW_CLASS = 'NPOS_albumCover--shadow';
// The README documents this class for resizing the glow with the cover.
const COVER_GLOW_CLASS = 'NPOS_coverGlow';
const PLAYING = {
  imgURL: 'cover.jpg',
  songTitle: 'Song',
  artist: 'Artist',
  album: 'Album',
  titleLength: 200000,
  progress: 1000,
  isPlaying: true,
  deviceName: 'Kitchen'
};

/**
 * NPOS_DomBuilder is a browser global without module.exports, so it is run
 * as a script inside a jsdom window, as MagicMirror loads it via
 * getScripts().
 */
function loadBuilder(mirrorConfig, moduleConfig) {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  if (mirrorConfig) {
    dom.window.config = mirrorConfig;
  }
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'core/NPOS_DomBuilder.js'), 'utf8'), context);
  const NPOS_DomBuilder = vm.runInContext('NPOS_DomBuilder', context);

  return new NPOS_DomBuilder(moduleConfig || {}, 'modules/MMM-NowPlayingOnSpotify', translate);
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

test('the cover carries the shadow class when coverShadow is on', () => {
  const builder = loadBuilder(null, { coverShadow: true });

  const cover = builder.getCoverArtDiv('cover.jpg').querySelector('img');

  assert.ok(cover.classList.contains('NPOS_albumCover'));
  assert.ok(cover.classList.contains(COVER_SHADOW_CLASS));
});

test('the cover has no shadow class when coverShadow is off', () => {
  const builder = loadBuilder(null, { coverShadow: false });

  const cover = builder.getCoverArtDiv('cover.jpg').querySelector('img');

  assert.ok(cover.classList.contains('NPOS_albumCover'));
  assert.ok(!cover.classList.contains(COVER_SHADOW_CLASS));
});

test('the stylesheet draws the shadow on the shadow class', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');

  assert.match(css, new RegExp('\\.' + COVER_SHADOW_CLASS + '\\s*\\{[^}]*box-shadow'));
});

test('a glow with the cover image lies behind the cover when coverGlow is on', () => {
  const builder = loadBuilder(null, { coverGlow: true });

  const images = builder.getCoverArtDiv('cover.jpg').querySelectorAll('img');

  assert.equal(images.length, 2);
  assert.ok(images[0].classList.contains(COVER_GLOW_CLASS));
  assert.equal(images[0].getAttribute('src'), 'cover.jpg');
  assert.ok(images[1].classList.contains('NPOS_albumCover'));
});

for (const moduleConfig of [{ coverGlow: false }, {}]) {
  test('the cover has no glow with ' + JSON.stringify(moduleConfig), () => {
    const builder = loadBuilder(null, moduleConfig);

    const area = builder.getCoverArtDiv('cover.jpg');

    assert.equal(area.querySelectorAll('img').length, 1);
    assert.equal(area.querySelector('.' + COVER_GLOW_CLASS), null);
  });
}

test('the glow replaces the shadow', () => {
  const builder = loadBuilder(null, { coverShadow: true, coverGlow: true });

  const cover = builder.getCoverArtDiv('cover.jpg').querySelector('.NPOS_albumCover');

  assert.ok(!cover.classList.contains(COVER_SHADOW_CLASS));
});

test('the stylesheet blurs the glow', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');

  assert.match(css, new RegExp('\\.' + COVER_GLOW_CLASS + '\\s*\\{[^}]*filter:\\s*blur'));
});

test('the README documents the glow class', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), new RegExp('`\\.' + COVER_GLOW_CLASS + '`'));
});

test('progress and play state leave the layout key unchanged', () => {
  const builder = loadBuilder();

  const later = Object.assign({}, PLAYING, { progress: 2000, isPlaying: false, hideWhileIdle: true });

  assert.equal(builder.getLayoutKey(later), builder.getLayoutKey(PLAYING));
});

for (const change of [{ imgURL: 'next.jpg' }, { songTitle: 'Next' }, { deviceName: 'Office' }, { unavailable: { reason: 'UNREACHABLE', retryAt: 1 } }]) {
  test('a change of ' + Object.keys(change)[0] + ' changes the layout key', () => {
    const builder = loadBuilder();

    assert.notEqual(builder.getLayoutKey(Object.assign({}, PLAYING, change)), builder.getLayoutKey(PLAYING));
  });
}

test('updating the info area keeps the cover and its glow', () => {
  const builder = loadBuilder(null, { showCoverArt: true, coverGlow: true });
  const wrapper = builder.getDom(PLAYING);
  const imagesBefore = Array.from(wrapper.querySelectorAll('img'));

  const updated = builder.updateInfoArea(wrapper, Object.assign({}, PLAYING, { progress: 61000, isPlaying: false }));

  assert.ok(updated);
  assert.deepEqual(Array.from(wrapper.querySelectorAll('img')), imagesBefore);
  assert.equal(wrapper.querySelector('.NPOS_progress').value, 61000);
  assert.ok(Array.from(wrapper.querySelectorAll('.NPOS_infoText')).some((line) => line.textContent === '1:01 / 3:20'));
  assert.ok(wrapper.querySelector('.fa-pause'));
});

test('updating a wrapper without info area reports that nothing was updated', () => {
  const builder = loadBuilder();

  assert.equal(builder.updateInfoArea(builder.getDom(NOTHING_PLAYING), PLAYING), false);
});
