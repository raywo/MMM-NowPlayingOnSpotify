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
    assert.ok(error instanceof SpotifyConnector.RateLimitError);
    assert.equal(error.retryAfterMs, 7200 * 1000);
    return true;
  });
});

test('a rate-limited player request is reported as a rate limit', async () => {
  global.fetch = async (url) => url.includes('/api/token')
    ? Response.json({ access_token: 'token', expires_in: 3600 })
    : new Response(null, { status: 429, headers: { 'Retry-After': '60' } });

  await assert.rejects(createConnector().retrieveCurrentlyPlaying(), SpotifyConnector.RateLimitError);
});
