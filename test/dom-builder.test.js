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
  // jsdom has no Web Animations API; the shared start time comes from here.
  dom.window.document.timeline = { currentTime: 1234 };
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

/**
 * jsdom has no layout and no Web Animations API. Gives the clip of a line
 * and its text the widths a browser would measure while the text is not
 * shifted, and records the animations started.
 */
function layOut(line, scrollWidth, clientWidth) {
  const clip = line.querySelector('.NPOS_infoTextClip');
  Object.defineProperty(clip, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(clip, 'clientWidth', { value: clientWidth, configurable: true });
  const inner = clip.firstChild;
  Object.defineProperty(inner, 'offsetWidth', { value: scrollWidth, configurable: true });
  inner.started = [];
  inner.getAnimations = () => inner.started.filter((animation) => !animation.cancelled);
  inner.animate = (keyframes, timing) => {
    const animation = { keyframes, timing, cancel() { this.cancelled = true; } };
    inner.started.push(animation);
    return animation;
  };

  return inner;
}

// Every line fits until a test lays one out wider.
function scrollableLines(infoArea) {
  const lines = Array.from(infoArea.querySelectorAll('.NPOS_infoText--scrollable'));
  lines.filter((line) => !line.querySelector('.NPOS_infoTextInner').animate)
    .forEach((line) => layOut(line, 100, 100));

  return lines;
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

test('title, artist, album and device scroll, the time does not', () => {
  const builder = loadBuilder(null, { scrollLongText: true });

  const lines = scrollableLines(builder.getInfoArea(PLAYING)).map((line) => line.textContent);

  assert.deepEqual(lines, ['Song', 'Artist', 'Album', 'Kitchen']);
});

test('no line scrolls with scrollLongText off', () => {
  const builder = loadBuilder(null, { scrollLongText: false });

  assert.equal(scrollableLines(builder.getInfoArea(PLAYING)).length, 0);
});

test('the icon stays outside the part that scrolls', () => {
  const builder = loadBuilder(null, { scrollLongText: true });

  const title = builder.getInfoArea(PLAYING).querySelector('.NPOS_infoText');

  assert.ok(title.querySelector(':scope > .NPOS_icon'));
  assert.equal(title.querySelector('.NPOS_infoTextClip .NPOS_icon'), null);
});

test('a line wider than its clip scrolls exactly to its end and back', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const title = scrollableLines(infoArea)[0];
  const inner = layOut(title, 380, 260);

  builder.scrollLongLines(infoArea);

  const transforms = Array.from(inner.started[0].keyframes, (frame) => frame.transform);
  // Ramps of 0.4 s at 40 px/s cover 8 px each.
  assert.deepEqual(transforms, [
    'translateX(0)',
    'translateX(0)', 'translateX(-8px)', 'translateX(-112px)', 'translateX(-120px)',
    'translateX(-120px)', 'translateX(-112px)', 'translateX(-8px)', 'translateX(0)',
    'translateX(0)'
  ]);
  assert.equal(inner.started[0].timing.iterations, Infinity);
  assert.ok(title.classList.contains('NPOS_infoText--scrolling'));
});

test('a line that fits does not move', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const title = scrollableLines(infoArea)[0];
  const inner = layOut(title, 260, 260);

  builder.scrollLongLines(infoArea);

  assert.equal(inner.started.length, 0);
  assert.ok(!title.classList.contains('NPOS_infoText--scrolling'));
});

test('lines of different length move alike until the shorter one stops', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const [title, artist] = scrollableLines(infoArea);
  const shortInner = layOut(title, 300, 260);
  const longInner = layOut(artist, 500, 260);

  builder.scrollLongLines(infoArea);

  const short = shortInner.started[0];
  const long = longInner.started[0];
  const position = (frame) => parseFloat(frame.transform.slice('translateX('.length));
  const time = (animation, index) => animation.keyframes[index].offset * animation.timing.duration;
  // Speed of the linear part, between the end of the ramp up and the start
  // of the ramp down, in pixels per millisecond.
  const speed = (animation) => (position(animation.keyframes[3]) - position(animation.keyframes[2]))
    / (time(animation, 3) - time(animation, 2));

  assert.equal(time(short, 2), time(long, 2));
  assert.equal(short.keyframes[2].transform, long.keyframes[2].transform);
  assert.equal(short.keyframes[1].easing, long.keyframes[1].easing);
  assert.ok(Math.abs(speed(short) - speed(long)) < 1e-9);
  assert.ok(Math.abs(speed(long) + 0.04) < 1e-9);
});

test('measuring again with the same width keeps the running animation', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const inner = layOut(scrollableLines(infoArea)[0], 380, 260);

  builder.scrollLongLines(infoArea);
  builder.scrollLongLines(infoArea);

  assert.equal(inner.started.length, 1);
  assert.ok(!inner.started[0].cancelled);
});

test('measuring again while the text is shifted keeps the full scroll distance', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const title = scrollableLines(infoArea)[0];
  const inner = layOut(title, 380, 260);
  builder.scrollLongLines(infoArea);

  // A browser counts the shifted text into the clip's scrollWidth.
  Object.defineProperty(title.querySelector('.NPOS_infoTextClip'), 'scrollWidth', { value: 300, configurable: true });
  builder.scrollLongLines(infoArea);

  assert.equal(inner.started.length, 1);
  assert.ok(!inner.started[0].cancelled);
});

test('a scrolling line that fits after a resize stops', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const title = scrollableLines(infoArea)[0];
  const inner = layOut(title, 380, 260);
  builder.scrollLongLines(infoArea);

  Object.defineProperty(title.querySelector('.NPOS_infoTextClip'), 'clientWidth', { value: 400, configurable: true });
  builder.scrollLongLines(infoArea);

  assert.ok(inner.started[0].cancelled);
  assert.equal(inner.getAnimations().length, 0);
  assert.ok(!title.classList.contains('NPOS_infoText--scrolling'));
});

test('custom.css sets speed and pause of the scrolling', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  infoArea.style.setProperty('--NPOS-scroll-speed', '20');
  infoArea.style.setProperty('--NPOS-scroll-pause', '3');
  const inner = layOut(scrollableLines(infoArea)[0], 380, 260);

  builder.scrollLongLines(infoArea);

  // 120 px at 20 px/s take 6 s plus 0.4 s of ramps each way, plus 3 s
  // pause at either end.
  const { keyframes, timing } = inner.started[0];
  assert.equal(timing.duration, 18800);
  assert.equal(keyframes[1].offset, 3000 / 18800);
});

test('invalid scroll settings fall back to the defaults', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  infoArea.style.setProperty('--NPOS-scroll-speed', '0');
  infoArea.style.setProperty('--NPOS-scroll-pause', 'slow');
  const inner = layOut(scrollableLines(infoArea)[0], 380, 260);

  builder.scrollLongLines(infoArea);

  // 120 px at 40 px/s take 3 s plus 0.4 s of ramps each way, plus 2 s
  // pause at either end.
  assert.equal(inner.started[0].timing.duration, 10800);
});

test('the lines carry the reviewed icons', () => {
  const builder = loadBuilder();

  const icons = Array.from(builder.getInfoArea(PLAYING).querySelectorAll('.NPOS_icon')).map((icon) => icon.className);

  assert.deepEqual(icons, [
    'NPOS_icon fa fa-music',
    'NPOS_icon fa fa-microphone',
    'NPOS_icon fa fa-compact-disc',
    'NPOS_icon fa fa-play',
    'NPOS_icon fa fa-headphones'
  ]);
});

test('updating the info area keeps the text lines in place', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const wrapper = builder.getDom(PLAYING);
  const linesBefore = Array.from(wrapper.querySelectorAll('.NPOS_infoText'));

  builder.updateInfoArea(wrapper, Object.assign({}, PLAYING, { progress: 61000 }));

  assert.deepEqual(Array.from(wrapper.querySelectorAll('.NPOS_infoText')), linesBefore);
});

test('the gap below the cover is set on the info area', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');

  assert.match(css, /\.NPOS_coverArtArea \+ \.NPOS_infoArea\s*\{[^}]*margin-top/);
  assert.doesNotMatch(css, /\.NPOS_albumCover\s*\{[^}]*margin-bottom/);
});

test('the README documents scrollLongText', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), /`scrollLongText`/);
});

test('overflowing lines share one cycle and start together', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const [title, artist] = scrollableLines(infoArea);
  const short = layOut(title, 300, 260).started;
  const long = layOut(artist, 500, 260).started;

  builder.scrollLongLines(infoArea);

  // 240 px at 40 px/s take 6 s plus 0.4 s of ramps each way, plus 2 s
  // pause at either end.
  assert.equal(short[0].timing.duration, 16800);
  assert.equal(long[0].timing.duration, 16800);
  assert.equal(short[0].startTime, 1234);
  assert.equal(long[0].startTime, 1234);
});

test('overflowing lines leave the start together and the end together', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const [title, artist] = scrollableLines(infoArea);
  const short = layOut(title, 300, 260).started;
  const long = layOut(artist, 500, 260).started;

  builder.scrollLongLines(infoArea);

  const offsets = (started) => Array.from(started[0].keyframes, (frame) => frame.offset);
  const [, shortLeavesStart, , , shortArrives, shortLeavesEnd, , , shortReturns] = offsets(short);
  const [, longLeavesStart, , , longArrives, longLeavesEnd] = offsets(long);
  assert.equal(shortLeavesStart, longLeavesStart);
  assert.equal(shortLeavesEnd, longLeavesEnd);
  // The shorter line waits at the end while the longer one still moves.
  assert.ok(shortArrives < longArrives);
  assert.ok(shortReturns < 1);
});

test('a line whose width changes restarts all lines together', () => {
  const builder = loadBuilder(null, { scrollLongText: true });
  const infoArea = builder.getInfoArea(PLAYING);
  const [title, artist] = scrollableLines(infoArea);
  const titleInner = layOut(title, 300, 260);
  const artistInner = layOut(artist, 500, 260);
  builder.scrollLongLines(infoArea);

  Object.defineProperty(titleInner, 'offsetWidth', { value: 350, configurable: true });
  builder.scrollLongLines(infoArea);

  assert.ok(artistInner.started[0].cancelled);
  assert.equal(artistInner.getAnimations().length, 1);
  assert.equal(titleInner.getAnimations().length, 1);
});
