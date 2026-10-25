'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const NodeModule = require('module');

// MagicMirror provides node_helper at runtime; create() hands back the
// definition, which is all these tests need.
const originalLoad = NodeModule._load;
NodeModule._load = function (request, ...rest) {
  if (request === 'node_helper') {
    return { create: (definition) => definition };
  }
  return originalLoad.call(this, request, ...rest);
};
const definition = require('../node_helper');
NodeModule._load = originalLoad;
const SpotifyConnector = require('../core/SpotifyConnector');

const RELAY_URI = 'https://raywo.github.io/MMM-NowPlayingOnSpotify/callback/';
const LAN_ADDRESS = '192.168.2.151';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RETRY_WINDOW_MS = 60 * 1000;
const MS_PER_SECOND = 1000;
const IDLE_CONFIG = { updatesEvery: 1, idleAfter: 30, idleUpdatesEvery: 10 };

let helper = null;

afterEach(() => {
  if (helper && helper.authServer) {
    helper.authServer.stop();
  }
  if (helper) {
    clearTimeout(helper.authRetryTimer);
  }
  helper = null;
  mock.restoreAll();
  mock.timers.reset();
});


function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function createHelper(config, obtainedAt) {
  const created = Object.create(definition);
  created.start();
  created.config = config;
  created.credentials = { clientID: 'id', clientSecret: 'secret' };
  created.store = { getRefreshTokenObtainedAt: () => obtainedAt || null };
  created.notifications = [];
  created.sendSocketNotification = (name, payload) => created.notifications.push({ name, payload });
  created.logs = [];
  created.log = (message) => created.logs.push(message);
  return created;
}

function interfacesWith(address) {
  return address
    ? { en0: [{ family: 'IPv4', address: address, internal: false }] }
    : { lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] };
}


test('starts the relay auth server once the network comes up while authorization is pending', async () => {
  const port = await freePort();
  let address = null;
  mock.method(os, 'networkInterfaces', () => interfacesWith(address));
  mock.method(fs, 'existsSync', () => false);
  mock.timers.enable({ apis: ['setTimeout'] });

  helper = createHelper({ redirectURI: RELAY_URI, authPort: port });
  helper.enterAuthRequired();

  assert.equal(helper.authServer, null);
  assert.equal(helper.notifications.at(-1).payload.authUnavailableReason, 'REAUTH_NO_LAN_ADDRESS');

  address = LAN_ADDRESS;
  mock.timers.tick(RETRY_WINDOW_MS);

  assert.ok(helper.authServer && helper.authServer.isRunning());
  const last = helper.notifications.at(-1);
  assert.equal(last.name, 'SPOTIFY_AUTH_REQUIRED');
  assert.equal(last.payload.authURL, 'http://' + LAN_ADDRESS + ':' + port + '/');
  assert.equal(last.payload.authUnavailableReason, null);
});

test('does not retry when no redirectURI is configured', () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  helper = createHelper({});
  helper.authUnavailableReason = 'REAUTH_NO_REDIRECT';
  helper.enterAuthRequired();
  const sent = helper.notifications.length;

  mock.timers.tick(RETRY_WINDOW_MS);

  assert.equal(helper.authRetryTimer, null);
  assert.equal(helper.notifications.length, sent);
});

test('the warning payload says why there is no authorization URL', () => {
  const obtainedAt = new Date(Date.now() - 180 * MS_PER_DAY);
  helper = createHelper({ redirectURI: RELAY_URI }, obtainedAt);
  helper.authUnavailableReason = 'REAUTH_INVALID_AUTH_HOST';

  const payload = helper.buildPayload(null, null);

  assert.equal(payload.reauthWarning, true);
  assert.equal(payload.authUnavailableReason, 'REAUTH_INVALID_AUTH_HOST');
});

test('the payload carries no reason outside the warning window', () => {
  helper = createHelper({ redirectURI: RELAY_URI }, new Date());
  helper.authUnavailableReason = 'REAUTH_INVALID_AUTH_HOST';

  const payload = helper.buildPayload(null, null);

  assert.equal(payload.reauthWarning, false);
  assert.equal(payload.authUnavailableReason, null);
});

function songData(isPlaying) {
  return {
    item: {
      name: 'Song',
      artists: [{ name: 'Artist' }],
      album: { name: 'Album', images: [] },
      duration_ms: 200 * MS_PER_SECOND
    },
    progress_ms: 0,
    is_playing: isPlaying,
    device: { name: 'Device' }
  };
}

// Answers each poll with the next response; an Error is thrown instead.
function createPollingHelper(config, responses) {
  const created = createHelper(config);
  created.connector = {
    retrieveCurrentlyPlaying: async () => {
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      return response;
    }
  };
  created.delays = [];
  created.scheduleNextPoll = (delayMs) => created.delays.push(delayMs);
  return created;
}

test('polls at idleUpdatesEvery once nothing has played for idleAfter seconds', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(IDLE_CONFIG, [null, null, null]);

  await helper.poll();
  mock.timers.tick(29 * MS_PER_SECOND);
  await helper.poll();
  mock.timers.tick(1 * MS_PER_SECOND);
  await helper.poll();

  assert.deepEqual(helper.delays, [1000, 1000, 10000]);
});

test('a paused song counts as nothing playing', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(IDLE_CONFIG, [songData(false), songData(false)]);

  await helper.poll();
  mock.timers.tick(30 * MS_PER_SECOND);
  await helper.poll();

  assert.equal(helper.delays.at(-1), 10000);
});

test('an ad or a podcast episode without track data still counts as playing', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const adBreak = { item: null, currently_playing_type: 'ad', is_playing: true };
  helper = createPollingHelper(IDLE_CONFIG, [adBreak, adBreak]);

  await helper.poll();
  mock.timers.tick(30 * MS_PER_SECOND);
  await helper.poll();

  assert.deepEqual(helper.delays, [1000, 1000]);
});

test('returns to updatesEvery as soon as something plays again', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(IDLE_CONFIG, [null, null, songData(true), null]);

  await helper.poll();
  mock.timers.tick(30 * MS_PER_SECOND);
  await helper.poll();
  await helper.poll();
  await helper.poll();

  assert.deepEqual(helper.delays, [1000, 10000, 1000, 1000]);
});

test('never polls faster when idle than updatesEvery', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper({ updatesEvery: 15, idleAfter: 30, idleUpdatesEvery: 10 }, [null, null]);

  await helper.poll();
  mock.timers.tick(30 * MS_PER_SECOND);
  await helper.poll();

  assert.deepEqual(helper.delays, [15000, 15000]);
});

test('waits as long as Spotify asks and logs the wait', async () => {
  const rateLimited = new SpotifyConnector.TransientError('Rate limited by Spotify.', 3 * 60 * 60 * MS_PER_SECOND);
  helper = createPollingHelper(IDLE_CONFIG, [rateLimited]);

  await helper.poll();

  assert.deepEqual(helper.delays, [3 * 60 * 60 * MS_PER_SECOND]);
  assert.match(helper.logs.at(-1), /retrying in 3 h\b/);
});

test('logs once when Spotify answers again after an error', async () => {
  const failure = new SpotifyConnector.TransientError('Spotify server error (status 503).');
  helper = createPollingHelper(IDLE_CONFIG, [failure, songData(true), songData(true)]);

  await helper.poll();
  await helper.poll();
  await helper.poll();

  const recoveries = helper.logs.filter((message) => message.includes('reachable again'));
  assert.equal(recoveries.length, 1);
});

test('logs the switch to and from idle polling with the new interval', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(IDLE_CONFIG, [null, null, songData(true)]);

  await helper.poll();
  mock.timers.tick(30 * MS_PER_SECOND);
  await helper.poll();
  await helper.poll();

  assert.deepEqual(helper.logs, [
    'Nothing playing for 30 s - polling every 10 s.',
    'Playback resumed - polling every 1 s.'
  ]);
});

function lastSongData(created) {
  const sent = created.notifications.filter((notification) => notification.name === 'RETRIEVED_SONG_DATA');
  return sent.at(-1).payload;
}

test('keeps quiet about failures that end within a minute', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const failure = new SpotifyConnector.TransientError('Network error contacting Spotify: timeout');
  helper = createPollingHelper(IDLE_CONFIG, [songData(true), failure, songData(true)]);

  await helper.poll();
  mock.timers.tick(5 * MS_PER_SECOND);
  await helper.poll();
  mock.timers.tick(5 * MS_PER_SECOND);
  await helper.poll();

  const sent = helper.notifications.filter((notification) => notification.payload.unavailable);
  assert.equal(sent.length, 0);
});

test('reports Spotify as unreachable once the data is a minute old', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const failure = () => new SpotifyConnector.TransientError('Network error contacting Spotify: timeout');
  helper = createPollingHelper(IDLE_CONFIG, [songData(true), failure(), failure()]);

  await helper.poll();
  await helper.poll();
  mock.timers.tick(60 * MS_PER_SECOND);
  await helper.poll();

  const payload = lastSongData(helper);
  assert.equal(payload.unavailable.reason, 'UNREACHABLE');
  assert.equal(payload.songTitle, 'Song');
});

test('reports a long rate limit right away with the time of the next attempt', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const waitMs = 3 * 60 * 60 * MS_PER_SECOND;
  const rateLimited = new SpotifyConnector.RateLimitError('Rate limited by Spotify.', waitMs);
  helper = createPollingHelper(IDLE_CONFIG, [songData(true), rateLimited]);

  await helper.poll();
  await helper.poll();

  assert.deepEqual(lastSongData(helper).unavailable, { reason: 'RATE_LIMITED', retryAt: waitMs });
});

test('reports a rate limit even before the first song arrived', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const rateLimited = new SpotifyConnector.RateLimitError('Rate limited by Spotify.', 3 * 60 * 60 * MS_PER_SECOND);
  helper = createPollingHelper(IDLE_CONFIG, [rateLimited]);

  await helper.poll();

  const payload = lastSongData(helper);
  assert.equal(payload.noSong, true);
  assert.equal(payload.unavailable.reason, 'RATE_LIMITED');
});

test('drops the report as soon as Spotify answers again', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const rateLimited = new SpotifyConnector.RateLimitError('Rate limited by Spotify.', 3 * 60 * 60 * MS_PER_SECOND);
  helper = createPollingHelper(IDLE_CONFIG, [rateLimited, songData(true)]);

  await helper.poll();
  await helper.poll();

  assert.equal(lastSongData(helper).unavailable, undefined);
});

test('keeps the report across a browser reload', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  const rateLimited = new SpotifyConnector.RateLimitError('Rate limited by Spotify.', 3 * 60 * 60 * MS_PER_SECOND);
  helper = createPollingHelper(IDLE_CONFIG, [songData(true), rateLimited]);
  helper.initOnce = () => {};
  helper.startPolling = () => {};

  await helper.poll();
  await helper.poll();
  helper.notifications = [];
  helper.handleConnect(IDLE_CONFIG);

  assert.equal(lastSongData(helper).unavailable.reason, 'RATE_LIMITED');
});

const HIDE_CONFIG = Object.assign({ hideAfter: 60 }, IDLE_CONFIG);

test('asks the mirror to hide the module once nothing has played for hideAfter seconds', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(HIDE_CONFIG, [null, null, null]);

  await helper.poll();
  assert.equal(lastSongData(helper).hideWhileIdle, false);
  mock.timers.tick(59 * MS_PER_SECOND);
  await helper.poll();
  assert.equal(lastSongData(helper).hideWhileIdle, false);
  mock.timers.tick(1 * MS_PER_SECOND);
  await helper.poll();
  assert.equal(lastSongData(helper).hideWhileIdle, true);
});

test('hides the module after a paused song too', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(HIDE_CONFIG, [songData(false), songData(false)]);

  await helper.poll();
  mock.timers.tick(60 * MS_PER_SECOND);
  await helper.poll();

  assert.equal(lastSongData(helper).hideWhileIdle, true);
});

test('shows the module again as soon as something plays', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(HIDE_CONFIG, [null, null, songData(true)]);

  await helper.poll();
  mock.timers.tick(60 * MS_PER_SECOND);
  await helper.poll();
  await helper.poll();

  assert.equal(lastSongData(helper).hideWhileIdle, false);
});

test('never hides the module without hideAfter', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(IDLE_CONFIG, [null, null]);

  await helper.poll();
  mock.timers.tick(24 * 60 * 60 * MS_PER_SECOND);
  await helper.poll();

  assert.equal(lastSongData(helper).hideWhileIdle, false);
});

test('keeps the module hidden across a browser reload', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 });
  helper = createPollingHelper(HIDE_CONFIG, [null, null]);
  helper.initOnce = () => {};
  helper.startPolling = () => {};

  await helper.poll();
  mock.timers.tick(60 * MS_PER_SECOND);
  await helper.poll();
  helper.notifications = [];
  helper.handleConnect(HIDE_CONFIG);

  assert.equal(lastSongData(helper).hideWhileIdle, true);
});
