
const request = require("request-promise-native");
const authorizationEndpoint = "https://accounts.spotify.com/authorize";
const tokenRefreshEndpoint = "https://accounts.spotify.com/api/token";
const apiEndpoint = "https://api.spotify.com/v1/me/player";
const redirectURI = "http://localhost:8888/callback";


class SpotifyConnector {

  constructor(credentials) {
    this.credentials = credentials;
  }

  retrieveCurrentlyPlaying() {
    let options = {
      url: apiEndpoint,
      headers: { 'Authorization': 'Bearer ' + this.credentials.accessToken },
      json: true
    };
  }
}