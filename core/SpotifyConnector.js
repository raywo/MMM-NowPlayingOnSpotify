'use strict';

/* MMM-NowPlayingOnSpotify - SpotifyConnector
 *
 * Talks to the Spotify Web API using the native fetch client (Node >= 18).
 * Manages access-token refresh against a TokenStore and classifies every
 * failure so the caller can react correctly:
 *
 *   - AuthRequiredError : the refresh token is dead (invalid_grant) or missing.
 *                         The user must re-authorize. Do NOT retry.
 *   - TransientError    : network / timeout / 5xx / 429 / unexpected. Keep the
 *                         last good data and retry on the next poll.
 *   - null              : nothing is playing (HTTP 204).
 *   - <object>          : the raw Spotify player payload (HTTP 200).
 */

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_PLAYER_ENDPOINT = 'https://api.spotify.com/v1/me/player';

const HTTP_TIMEOUT_MS = 15 * 1000;
// Refresh a little before the access token actually expires to avoid races.
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000;
const DEFAULT_RETRY_AFTER_MS = 5 * 1000;

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;


class AuthRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}


class TransientError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'TransientError';
    this.retryAfterMs = retryAfterMs || DEFAULT_RETRY_AFTER_MS;
  }
}


class SpotifyConnector {

  /**
   * @param {object} credentials { clientID, clientSecret }
   * @param {TokenStore} store
   */
  constructor(credentials, store) {
    this.credentials = credentials;
    this.store = store;
  }

  /**
   * @returns {Promise<object|null>} raw player payload, or null when nothing
   *   is playing. Rejects with AuthRequiredError or TransientError.
   */
  async retrieveCurrentlyPlaying() {
    await this._ensureAccessToken();
    return this._getSpotifyData(true);
  }

  async _ensureAccessToken() {
    const now = new Date();
    const expiresAt = this.store.getAccessTokenExpiresAt();

    if (expiresAt && now.getTime() < expiresAt.getTime() - TOKEN_EXPIRY_SKEW_MS) {
      return;
    }

    await this._refreshAccessToken();
  }

  async _refreshAccessToken() {
    const refreshToken = this.store.getRefreshToken();

    if (!refreshToken) {
      throw new AuthRequiredError('No refresh token available - authorization required.');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });

    const response = await this._fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + this._basicAuth(),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (response.ok) {
      const json = await this._parseJson(response);
      this.store.updateFromRefresh(json, new Date());
      return;
    }

    if (response.status === HTTP_BAD_REQUEST) {
      const json = await this._parseJson(response);
      if (json && json.error === 'invalid_grant') {
        throw new AuthRequiredError('Refresh token expired or revoked (invalid_grant).');
      }
    }

    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw new TransientError('Rate limited by Spotify (token refresh).', this._retryAfterMs(response));
    }

    throw new TransientError('Token refresh failed with status ' + response.status);
  }

  async _getSpotifyData(allowRetry) {
    const response = await this._fetchWithTimeout(API_PLAYER_ENDPOINT, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + this.store.getAccessToken() }
    });

    if (response.status === HTTP_NO_CONTENT) {
      return null;
    }

    if (response.status === HTTP_OK) {
      return this._parseJson(response);
    }

    if (response.status === HTTP_UNAUTHORIZED && allowRetry) {
      // Access token rejected early - refresh once and retry a single time.
      await this._refreshAccessToken();
      return this._getSpotifyData(false);
    }

    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw new TransientError('Rate limited by Spotify.', this._retryAfterMs(response));
    }

    if (response.status >= HTTP_SERVER_ERROR_MIN) {
      throw new TransientError('Spotify server error (status ' + response.status + ').');
    }

    throw new TransientError('Unexpected player status ' + response.status + '.');
  }

  _retryAfterMs(response) {
    const header = response.headers.get('retry-after');
    const seconds = Number(header);
    if (!header || Number.isNaN(seconds)) {
      return DEFAULT_RETRY_AFTER_MS;
    }
    return seconds * 1000;
  }

  _basicAuth() {
    return Buffer
      .from(this.credentials.clientID + ':' + this.credentials.clientSecret)
      .toString('base64');
  }

  async _parseJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async _fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } catch (err) {
      throw new TransientError('Network error contacting Spotify: ' + err.message);
    } finally {
      clearTimeout(timer);
    }
  }
}


module.exports = SpotifyConnector;
module.exports.AuthRequiredError = AuthRequiredError;
module.exports.TransientError = TransientError;
