'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
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
 * Loads the frontend like MagicMirror does: the DomBuilder as a script, then
 * the module definition through Module.register. updateDom() renders via
 * getDom() as MagicMirror would and counts the calls. The window's clock and
 * intervals are replaced by module.clock, which tests move on by hand.
 */
function loadModule(moduleConfig) {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  const context = dom.getInternalVMContext();
  const clock = new FakeClock();
  let definition;
  dom.window.Module = { register: (name, moduleDefinition) => { definition = moduleDefinition; } };
  dom.window.Log = { info: () => {} };
  dom.window.ResizeObserver = FakeResizeObserver;
  dom.window.Date.now = () => clock.now;
  dom.window.setInterval = (callback, delay) => clock.setInterval(callback, delay);
  dom.window.clearInterval = (id) => clock.clearInterval(id);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'core/NPOS_DomBuilder.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'MMM-NowPlayingOnSpotify.js'), 'utf8'), context);

  const module = Object.assign(Object.create(definition), {
    name: 'MMM-NowPlayingOnSpotify',
    identifier: 'module_0',
    config: Object.assign({}, definition.defaults, moduleConfig),
    domUpdates: 0,
    clock: clock,
    sendSocketNotification: () => {},
    file: (name) => 'modules/MMM-NowPlayingOnSpotify/' + name,
    translate: (key) => key,
    hide: () => {},
    show: () => {},
    updateDom() {
      this.domUpdates++;
      this.getDom();
    }
  });
  module.start();
  module.getDom();

  return module;
}

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.intervals = new Map();
  }

  setInterval(callback, delay) {
    const id = this.nextId++;
    this.intervals.set(id, { callback, delay, due: this.now + delay });
    return id;
  }

  clearInterval(id) {
    this.intervals.delete(id);
  }

  get running() {
    return this.intervals.size;
  }

  tick(ms) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.intervals.entries()]
        .filter(([, interval]) => interval.due <= end)
        .sort(([, a], [, b]) => a.due - b.due)[0];
      if (!next) {
        break;
      }
      const [, interval] = next;
      this.now = interval.due;
      interval.due += interval.delay;
      interval.callback();
    }
    this.now = end;
  }
}

// jsdom has no layout, so nothing would ever be observed; records instead.
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.disconnected = false;
  }

  observe(target) {
    this.targets.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }
}

function receive(module, payload) {
  module.socketNotificationReceived('RETRIEVED_SONG_DATA', payload);
}


test('a poll for the same track updates the info area without rebuilding the cover', () => {
  const module = loadModule({ coverGlow: true });
  receive(module, PLAYING);
  const glow = module.renderedDom.querySelector('.NPOS_coverGlow');

  receive(module, Object.assign({}, PLAYING, { progress: 2000 }));

  assert.equal(module.domUpdates, 1);
  assert.equal(module.renderedDom.querySelector('.NPOS_coverGlow'), glow);
  assert.equal(module.renderedDom.querySelector('.NPOS_progress').value, 2000);
});

test('a new track rebuilds the module so the glow follows the cover', () => {
  const module = loadModule({ coverGlow: true });
  receive(module, PLAYING);

  receive(module, Object.assign({}, PLAYING, { imgURL: 'next.jpg', songTitle: 'Next' }));

  assert.equal(module.domUpdates, 2);
  assert.equal(module.renderedDom.querySelector('.NPOS_coverGlow').getAttribute('src'), 'next.jpg');
});

test('song data after a re-authorization rebuilds the module', () => {
  const module = loadModule();
  receive(module, PLAYING);
  module.socketNotificationReceived('SPOTIFY_AUTH_REQUIRED', {});

  receive(module, PLAYING);

  assert.equal(module.domUpdates, 3);
  assert.ok(module.renderedDom.querySelector('.NPOS_infoArea'));
});

test('a poll for the same track keeps the text lines, so their scrolling runs on', () => {
  const module = loadModule();
  receive(module, PLAYING);
  const title = module.renderedDom.querySelector('.NPOS_infoText');

  receive(module, Object.assign({}, PLAYING, { progress: 2000, isPlaying: false }));

  assert.equal(module.renderedDom.querySelector('.NPOS_infoText'), title);
  assert.ok(module.renderedDom.querySelector('.NPOS_infoText--time .fa-pause'));
  assert.equal(module.renderedDom.querySelector('.NPOS_infoText--time').textContent, '0:02 / 3:20');
});

test('a rendered info area is watched for its size', () => {
  const module = loadModule();

  receive(module, PLAYING);

  assert.deepEqual(module.lineObserver.targets, [module.renderedDom.querySelector('.NPOS_infoArea')]);
});

test('a rebuild stops watching the previous info area', () => {
  const module = loadModule();
  receive(module, PLAYING);
  const previous = module.lineObserver;

  receive(module, Object.assign({}, PLAYING, { songTitle: 'Next' }));

  assert.ok(previous.disconnected);
  assert.notEqual(module.lineObserver, previous);
});

test('nothing is watched with scrollLongText off', () => {
  const module = loadModule({ scrollLongText: false });

  receive(module, PLAYING);

  assert.equal(module.lineObserver, null);
});

function shownTime(module) {
  return module.renderedDom.querySelector('.NPOS_infoText--time').textContent;
}

function shownProgress(module) {
  return module.renderedDom.querySelector('.NPOS_progress').value;
}

test('time and progress bar move on every second between polls', () => {
  const module = loadModule({ updatesEvery: 10 });
  receive(module, PLAYING);

  module.clock.tick(1000);
  assert.equal(shownProgress(module), 2000);
  assert.equal(shownTime(module), '0:02 / 3:20');

  module.clock.tick(4000);
  assert.equal(shownProgress(module), 6000);
  assert.equal(shownTime(module), '0:06 / 3:20');
});

test('a poll resets the progress to what Spotify reports', () => {
  const module = loadModule();
  receive(module, PLAYING);
  module.clock.tick(3000);

  receive(module, Object.assign({}, PLAYING, { progress: 3500 }));
  assert.equal(shownProgress(module), 3500);

  module.clock.tick(1000);
  assert.equal(shownProgress(module), 4500);
});

test('the tick neither rebuilds the module nor replaces cover and lines', () => {
  const module = loadModule({ coverGlow: true });
  receive(module, PLAYING);
  const glow = module.renderedDom.querySelector('.NPOS_coverGlow');
  const title = module.renderedDom.querySelector('.NPOS_infoText');

  module.clock.tick(5000);

  assert.equal(module.domUpdates, 1);
  assert.equal(module.renderedDom.querySelector('.NPOS_coverGlow'), glow);
  assert.equal(module.renderedDom.querySelector('.NPOS_infoText'), title);
});

test('the bar stands still while paused', () => {
  const module = loadModule();
  receive(module, Object.assign({}, PLAYING, { isPlaying: false }));

  module.clock.tick(5000);

  assert.equal(shownProgress(module), 1000);
  assert.equal(module.clock.running, 0);
});

test('pausing stops the bar at the reported position', () => {
  const module = loadModule();
  receive(module, PLAYING);
  module.clock.tick(2000);

  receive(module, Object.assign({}, PLAYING, { progress: 2500, isPlaying: false }));
  module.clock.tick(5000);

  assert.equal(shownProgress(module), 2500);
});

test('the bar never runs past the end of the track', () => {
  const module = loadModule();
  receive(module, Object.assign({}, PLAYING, { progress: 198500 }));

  module.clock.tick(5000);

  assert.equal(shownProgress(module), 200000);
  assert.equal(shownTime(module), '3:20 / 3:20');
  assert.equal(module.clock.running, 0);
});

test('a new track restarts the bar from its own progress', () => {
  const module = loadModule();
  receive(module, PLAYING);
  module.clock.tick(3000);

  receive(module, Object.assign({}, PLAYING, { songTitle: 'Next', progress: 0 }));
  module.clock.tick(1000);

  assert.equal(shownProgress(module), 1000);
  assert.equal(module.clock.running, 1);
});

test('nothing ticks while nothing plays', () => {
  const module = loadModule();
  receive(module, PLAYING);

  receive(module, { noSong: true });

  assert.equal(module.clock.running, 0);
});

test('nothing ticks while re-authorization is pending', () => {
  const module = loadModule();
  receive(module, PLAYING);

  module.socketNotificationReceived('SPOTIFY_AUTH_REQUIRED', {});

  assert.equal(module.clock.running, 0);
});

test('nothing ticks while the module is hidden, and it catches up when shown', () => {
  const module = loadModule();
  receive(module, PLAYING);

  module.suspend();
  assert.equal(module.clock.running, 0);
  module.clock.tick(5000);
  assert.equal(shownProgress(module), 1000);

  module.resume();
  assert.equal(shownProgress(module), 6000);
  assert.equal(module.clock.running, 1);
});
