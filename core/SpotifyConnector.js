'use strict';

const request = require('request-promise-native');
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
          console.log('Refreshed access token because it has expired. Expired at: %s now is: %s',
            this.tokenExpiresAt.format('HH:mm:ss'), moment().format('HH:mm:ss'));

          this.credentials.accessToken = response.access_token;
          this.tokenExpiresAt = moment().add(response.expires_in, 'seconds');

          return this.getSpotifyData();
        })
        .catch((err) => {
          console.error('Error while refreshing:');
          console.error(err);
        });
    }
  }

  getSpotifyData() {
    let options = {
      url: apiEndpoint,
      headers: {'Authorization': 'Bearer ' + this.credentials.accessToken},
      json: true
    };

    return request.get(options);
  }

  refreshAccessToken() {
    let client_id = this.credentials.clientID;
    let client_secret = this.credentials.clientSecret;
    let options = {
      url: tokenRefreshEndpoint,
      headers: { 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64')) },
      form: {
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refreshToken
      },
      json: true
    };

    return request.post(options);
  }
};
