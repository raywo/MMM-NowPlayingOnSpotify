'use strict';

const request = require('request-promise-native');
const fs = require('fs');

const authorizationEndpoint = 'https://accounts.spotify.com/authorize';
const tokenRefreshEndpoint = 'https://accounts.spotify.com/api/token';
const apiEndpoint = 'https://api.spotify.com/v1/me/player';
const redirectURI = 'http://localhost:8888/callback';


module.exports = class SpotifyConnector {

  constructor(credentials) {
    this.credentials = credentials;
    this.credentialsFile = this.credentials.filePath + 'credentials.json';
  }

  retrieveCurrentlyPlaying() {
    this.updateAccessToken();

    let options = {
      url: apiEndpoint,
      headers: { 'Authorization': 'Bearer ' + this.credentials.accessToken },
      json: true
    };

    return request.get(options);
  }

  refreshAccessToken(callback) {
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

    request.post(options).then((response) => {
      this.credentials.accessToken = response.access_token;
      this.writeCredentialsToFile();
      callback();
    });
  }

  writeCredentialsToFile() {
    let serializedCredentials = JSON.stringify(this.credentials);
    fs.writeFileSync(this.credentialsFile, serializedCredentials);
  }


  readCredentialsFromFile() {
    return fs.readFileSync(this.credentialsFile, 'utf8');
  }

  updateAccessToken() {
    let newCredentials = this.readCredentialsFromFile();

    if (newCredentials.accessToken) {
      this.credentials = newCredentials;
    }
  }
};
