'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const SpotifyConnector = require('../core/SpotifyConnector');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});


function createConnector() {
  const store = {
    getAccessTokenExpiresAt: () => null,
    getRefreshToken: () => 'refresh-token',
    getAccessToken: () => null,
    updateFromRefresh: () => {}
  };
  return new SpotifyConnector({ clientID: 'id', clientSecret: 'secret' }, store);
}

test('a rate-limited token refresh waits as long as Spotify asks', async () => {
  global.fetch = async () => new Response(null, { status: 429, headers: { 'Retry-After': '7200' } });

  await assert.rejects(createConnector().retrieveCurrentlyPlaying(), (error) => {
    assert.ok(error instanceof SpotifyConnector.TransientError);
    assert.equal(error.retryAfterMs, 7200 * 1000);
    return true;
  });
});
