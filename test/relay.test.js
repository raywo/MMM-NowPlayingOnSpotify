'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isPrivateIPv4, parseState, buildTarget } = require('../docs/callback/relay.js');

const NONCE = 'abcdefghijklmnop';

function state(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}


test('accepts private, link-local and loopback IPv4 addresses', () => {
  for (const host of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.20', '169.254.1.1', '127.0.0.1']) {
    assert.equal(isPrivateIPv4(host), true, host);
  }
});

test('rejects public addresses, hostnames and ambiguous notations', () => {
  for (const host of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', 'example.com',
    'mirror.local', '192.168.1', '192.168.001.20', '0x7f.0.0.1', '256.0.0.1', '192.168.1.20.evil.com', '']) {
    assert.equal(isPrivateIPv4(host), false, host);
  }
});

test('parses a well-formed state', () => {
  assert.deepEqual(parseState(state({ h: '192.168.1.20', p: 8888, n: NONCE })),
    { host: '192.168.1.20', port: 8888 });
});

test('rejects malformed or unsafe states', () => {
  const invalid = [
    null,
    '',
    'not-base64-json',
    state(null),
    state('192.168.1.20'),
    state({ h: 'evil.com', p: 8888, n: NONCE }),
    state({ h: '192.168.1.20', p: 0, n: NONCE }),
    state({ h: '192.168.1.20', p: 65536, n: NONCE }),
    state({ h: '192.168.1.20', p: '8888', n: NONCE }),
    state({ h: '192.168.1.20', p: 8888, n: 'short' }),
    state({ h: '192.168.1.20', p: 8888, n: 'abcdefghijklmnop/' }),
    state({ h: '192.168.1.20', p: 8888 })
  ];
  for (const value of invalid) {
    assert.equal(parseState(value), null, String(value));
  }
});

test('forwards code and state unchanged to the mirror callback', () => {
  const s = state({ h: '192.168.1.20', p: 8888, n: NONCE });
  const target = buildTarget('?code=abc123&state=' + s);
  const url = new URL(target);

  assert.equal(url.origin, 'http://192.168.1.20:8888');
  assert.equal(url.pathname, '/callback');
  assert.equal(url.searchParams.get('code'), 'abc123');
  assert.equal(url.searchParams.get('state'), s);
});

test('forwards an error from Spotify as well', () => {
  const target = buildTarget('?error=access_denied&state=' + state({ h: '10.0.0.5', p: 8888, n: NONCE }));
  assert.equal(new URL(target).searchParams.get('error'), 'access_denied');
});

test('does not forward without a valid state', () => {
  assert.equal(buildTarget('?code=abc123'), null);
  assert.equal(buildTarget('?code=abc123&state=' + state({ h: '8.8.8.8', p: 80, n: NONCE })), null);
});
