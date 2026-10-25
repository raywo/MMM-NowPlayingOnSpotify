'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectLanAddress, resolveAuthAddress } = require('../core/LanAddress');


function ipv4(address, internal) {
  return { family: 'IPv4', address: address, internal: Boolean(internal) };
}


test('picks the private address of a regular interface', () => {
  const interfaces = {
    lo0: [ipv4('127.0.0.1', true)],
    en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, ipv4('192.168.2.151')]
  };
  assert.equal(detectLanAddress(interfaces), '192.168.2.151');
});

test('prefers a routable private address over link-local', () => {
  const interfaces = {
    en29: [ipv4('169.254.17.92')],
    en0: [ipv4('10.0.0.7')]
  };
  assert.equal(detectLanAddress(interfaces), '10.0.0.7');
});

test('falls back to link-local when nothing else is there', () => {
  assert.equal(detectLanAddress({ en0: [ipv4('169.254.17.92')] }), '169.254.17.92');
});

test('ignores public and internal addresses', () => {
  const interfaces = {
    lo0: [ipv4('127.0.0.1', true)],
    en0: [ipv4('203.0.113.5')]
  };
  assert.equal(detectLanAddress(interfaces), null);
});


const NO_INTERFACES = {};

test('resolves the detected address and the default port', () => {
  const interfaces = { en0: [ipv4('192.168.2.151')] };
  assert.deepEqual(resolveAuthAddress({}, interfaces), { host: '192.168.2.151', port: 8888 });
});

test('prefers the configured authHost and authPort', () => {
  const interfaces = { en0: [ipv4('192.168.2.151')] };
  assert.deepEqual(resolveAuthAddress({ authHost: '10.0.0.7', authPort: 9000 }, interfaces),
    { host: '10.0.0.7', port: 9000 });
});

test('rejects an authHost the relay page would not forward to', () => {
  for (const authHost of ['magicmirror.local', '203.0.113.5']) {
    assert.equal(resolveAuthAddress({ authHost: authHost }, NO_INTERFACES).error, 'REAUTH_INVALID_AUTH_HOST');
  }
});

test('rejects an authPort outside the valid range', () => {
  for (const authPort of [70000, -1, 80.5]) {
    assert.equal(resolveAuthAddress({ authHost: '10.0.0.7', authPort: authPort }, NO_INTERFACES).error,
      'REAUTH_INVALID_AUTH_PORT');
  }
});

test('reports a missing LAN address', () => {
  assert.equal(resolveAuthAddress({}, NO_INTERFACES).error, 'REAUTH_NO_LAN_ADDRESS');
});
