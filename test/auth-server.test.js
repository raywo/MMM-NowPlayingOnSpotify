'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const SpotifyAuthServer = require('../core/SpotifyAuthServer');
const { parseState } = require('../docs/callback/relay.js');

const RELAY_URI = 'https://raywo.github.io/MMM-NowPlayingOnSpotify/callback/';
const STATUS_OK = 200;
const STATUS_FOUND = 302;
const STATUS_BAD_REQUEST = 400;

let server = null;
const originalFetch = global.fetch;

afterEach(() => {
  if (server) {
    server.stop();
    server = null;
  }
  global.fetch = originalFetch;
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

function fakeStore() {
  return {
    stored: null,
    updateFromAuth(tokens) {
      this.stored = tokens;
    }
  };
}

async function startServer(options) {
  server = new SpotifyAuthServer(Object.assign({
    credentials: { clientID: 'id', clientSecret: 'secret' },
    store: fakeStore()
  }, options));
  server.start();
  await new Promise((resolve) => server.server.once('listening', resolve));
  return server;
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    }).on('error', reject);
  });
}

function authorizeParams(res) {
  return new URL(res.headers.location).searchParams;
}


test('relay mode listens on the LAN and points the entry URL at it', async () => {
  const port = await freePort();
  const auth = await startServer({ redirectURI: RELAY_URI, lanHost: '127.0.0.1', lanPort: port });

  assert.equal(auth.isRelayMode(), true);
  assert.equal(auth.getEntryURL(), 'http://127.0.0.1:' + port + '/');
  assert.equal(auth.server.address().address, '0.0.0.0');
});

test('relay mode sends a state the relay page accepts', async () => {
  const port = await freePort();
  await startServer({ redirectURI: RELAY_URI, lanHost: '127.0.0.1', lanPort: port });

  const res = await get('http://127.0.0.1:' + port + '/');
  const params = authorizeParams(res);

  assert.equal(res.statusCode, STATUS_FOUND);
  assert.equal(res.headers.location.startsWith('https://accounts.spotify.com/authorize?'), true);
  assert.equal(params.get('redirect_uri'), RELAY_URI);
  assert.deepEqual(parseState(params.get('state')), { host: '127.0.0.1', port: port });
});

test('relay mode stores tokens from a callback with the issued state', async () => {
  const port = await freePort();
  let succeeded = false;
  const auth = await startServer({
    redirectURI: RELAY_URI, lanHost: '127.0.0.1', lanPort: port,
    onSuccess: () => { succeeded = true; }
  });
  global.fetch = async (url, init) => {
    assert.equal(new URLSearchParams(init.body).get('redirect_uri'), RELAY_URI);
    return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r' }) };
  };

  const state = authorizeParams(await get('http://127.0.0.1:' + port + '/')).get('state');
  const res = await get('http://127.0.0.1:' + port + '/callback?code=c&state=' + state);

  assert.equal(res.statusCode, STATUS_OK);
  assert.equal(auth.store.stored.refresh_token, 'r');
  assert.equal(succeeded, true);
});

test('relay mode rejects a callback with a foreign state', async () => {
  const port = await freePort();
  await startServer({ redirectURI: RELAY_URI, lanHost: '127.0.0.1', lanPort: port });

  await get('http://127.0.0.1:' + port + '/');
  const res = await get('http://127.0.0.1:' + port + '/callback?code=c&state=forged');

  assert.equal(res.statusCode, STATUS_BAD_REQUEST);
});

test('loopback mode keeps listening on loopback at the redirect URI port', async () => {
  const port = await freePort();
  const redirectURI = 'http://127.0.0.1:' + port + '/callback';
  const auth = await startServer({ redirectURI: redirectURI });

  assert.equal(auth.isRelayMode(), false);
  assert.equal(auth.getEntryURL(), 'http://127.0.0.1:' + port + '/');
  assert.equal(auth.server.address().address, '127.0.0.1');

  const res = await get(auth.getEntryURL());
  assert.equal(res.statusCode, STATUS_FOUND);
  assert.equal(authorizeParams(res).get('redirect_uri'), redirectURI);
});
