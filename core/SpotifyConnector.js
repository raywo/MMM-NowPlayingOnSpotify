'use strict';

const moment = require('moment');

const tokenRefreshEndpoint = 'https://accounts.spotify.com/api/token';
const apiEndpoint = 'https://api.spotify.com/v1/me/player';

module.exports = class SpotifyConnector {
  constructor(credentials) {
    this.credentials = credentials;
    this.tokenExpiresAt = moment();
  }

  retrieveCurrentlyPlaying() {
    if (moment().isBefore(this.tokenExpiresAt)) {
      return this.getSpotifyData();
    } else {
      return this.refreshAccessToken()
        .then((response) => {
          console.log(
            'Refreshed access token. Expired at: %s, now: %s',
            this.tokenExpiresAt.format('HH:mm:ss'),
            moment().format('HH:mm:ss')
          );
          this.credentials.accessToken = response.access_token;
          this.tokenExpiresAt = moment().add(response.expires_in, 'seconds');
          return this.getSpotifyData();
        })
        .catch((err) => {
          console.error('Error while refreshing access token:', err);
          throw err;
        });
    }
  }

  async getSpotifyData() {
    const res = await fetch(apiEndpoint, {
      headers: { 'Authorization': 'Bearer ' + this.credentials.accessToken }
    });

    if (res.status === 204) return null; // No song playing
    if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);

    return res.json();
  }

  async refreshAccessToken() {
    const { clientID, clientSecret, refreshToken } = this.credentials;
    const basicAuth = Buffer.from(`${clientID}:${clientSecret}`).toString('base64');

    const res = await fetch(tokenRefreshEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

    return res.json();
  }
};