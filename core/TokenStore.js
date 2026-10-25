'use strict';

/* MMM-NowPlayingOnSpotify - TokenStore
 *
 * Persists Spotify tokens (access + refresh) in a module-local file so the
 * module can refresh access tokens and re-authorize WITHOUT the user having to
 * edit config.js. The file holds secrets and must never be committed
 * (see .gitignore).
 *
 * Schema of tokens.json:
 *   {
 *     "accessToken": "<string>",
 *     "refreshToken": "<string>",
 *     "accessTokenExpiresAt": "<ISO-8601>",     // when the 1h access token expires
 *     "refreshTokenObtainedAt": "<ISO-8601>|null" // when the refresh token was issued
 *   }
 *
 * refreshTokenObtainedAt is only known precisely for tokens obtained through our
 * own authorization flow. For tokens seeded from a legacy config.js it stays
 * null (issue date unknown), so the proactive expiry warning is skipped for
 * those; the hard invalid_grant path still catches their expiry.
 */

const fs = require('fs');
const path = require('path');

const TOKENS_FILENAME = 'tokens.json';
const FILE_ENCODING = 'utf8';

module.exports = class TokenStore {

  constructor(moduleDir) {
    this.filePath = path.join(moduleDir, TOKENS_FILENAME);
    this.tmpPath = this.filePath + '.tmp';
    this.data = null;
  }

  /**
   * Loads tokens.json into memory. Missing or corrupt file yields an empty
   * store (this.data = {}), never throws.
   */
  load() {
    try {
      const raw = fs.readFileSync(this.filePath, FILE_ENCODING);
      this.data = JSON.parse(raw);
    } catch {
      this.data = {};
    }
    return this.data;
  }

  hasRefreshToken() {
    return Boolean(this.data && this.data.refreshToken);
  }

  getAccessToken() {
    return this.data ? this.data.accessToken : undefined;
  }

  getRefreshToken() {
    return this.data ? this.data.refreshToken : undefined;
  }

  /**
   * @returns {Date|null} expiry of the current access token, or null if unknown.
   */
  getAccessTokenExpiresAt() {
    if (!this.data || !this.data.accessTokenExpiresAt) {
      return null;
    }
    return new Date(this.data.accessTokenExpiresAt);
  }

  /**
   * @returns {Date|null} issue time of the current refresh token, or null if
   *   unknown (e.g. seeded from legacy config).
   */
  getRefreshTokenObtainedAt() {
    if (!this.data || !this.data.refreshTokenObtainedAt) {
      return null;
    }
    return new Date(this.data.refreshTokenObtainedAt);
  }

  /**
   * One-time migration: if the store has no refresh token yet but config.js
   * carries one, adopt the config credentials. The issue date is unknown for
   * these, so refreshTokenObtainedAt stays null.
   *
   * @returns {boolean} true if the store was seeded from config.
   */
  seedFromConfig(config) {
    if (this.hasRefreshToken() || !config || !config.refreshToken) {
      return false;
    }

    this.data = {
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      // Force a refresh on first use: treat the seeded access token as expired.
      accessTokenExpiresAt: new Date(0).toISOString(),
      refreshTokenObtainedAt: null
    };
    this.persist();
    return true;
  }

  /**
   * Updates the store after a successful access-token refresh. A rotated
   * refresh token (if Spotify returns one) is persisted; the obtained-at
   * timestamp is NOT reset, because refreshing does not extend the refresh
   * token's 6-month lifetime.
   *
   * @param {object} response Spotify token endpoint response.
   * @param {Date} now Current time.
   */
  updateFromRefresh(response, now) {
    this.data = this.data || {};
    this.data.accessToken = response.access_token;
    this.data.accessTokenExpiresAt = this._expiryFrom(response, now);

    if (response.refresh_token) {
      this.data.refreshToken = response.refresh_token;
    }

    this.persist();
  }

  /**
   * Updates the store after a full authorization-code exchange (initial setup
   * or re-authorization). Here the refresh token is brand new, so its
   * obtained-at timestamp is recorded for the proactive expiry warning.
   *
   * @param {object} response Spotify token endpoint response.
   * @param {Date} now Current time.
   */
  updateFromAuth(response, now) {
    this.data = this.data || {};
    this.data.accessToken = response.access_token;
    this.data.refreshToken = response.refresh_token;
    this.data.accessTokenExpiresAt = this._expiryFrom(response, now);
    this.data.refreshTokenObtainedAt = now.toISOString();
    this.persist();
  }

  _expiryFrom(response, now) {
    const seconds = Number(response.expires_in) || 0;
    return new Date(now.getTime() + seconds * 1000).toISOString();
  }

  /**
   * Atomic write: serialize to a temp file, then rename over the target so a
   * crash mid-write can never leave a corrupt tokens.json.
   */
  persist() {
    const json = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(this.tmpPath, json, FILE_ENCODING);
    fs.renameSync(this.tmpPath, this.filePath);
  }
};
