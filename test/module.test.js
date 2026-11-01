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
 * getDom() as MagicMirror would and counts the calls.
 */
function loadModule(moduleConfig) {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  const context = dom.getInternalVMContext();
  let definition;
  dom.window.Module = { register: (name, moduleDefinition) => { definition = moduleDefinition; } };
  dom.window.Log = { info: () => {} };
  dom.window.ResizeObserver = FakeResizeObserver;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'core/NPOS_DomBuilder.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'MMM-NowPlayingOnSpotify.js'), 'utf8'), context);

  const module = Object.assign(Object.create(definition), {
    name: 'MMM-NowPlayingOnSpotify',
    identifier: 'module_0',
    config: Object.assign({}, definition.defaults, moduleConfig),
    domUpdates: 0,
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
