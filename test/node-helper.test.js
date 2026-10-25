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

const RELAY_URI = 'https://raywo.github.io/MMM-NowPlayingOnSpotify/callback/';
const LAN_ADDRESS = '192.168.2.151';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RETRY_WINDOW_MS = 60 * 1000;

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
  created.log = () => {};
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
