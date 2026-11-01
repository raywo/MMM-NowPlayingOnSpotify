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
