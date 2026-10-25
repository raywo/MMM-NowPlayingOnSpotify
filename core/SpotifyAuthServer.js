'use strict';

/* MMM-NowPlayingOnSpotify - SpotifyAuthServer
 *
 * A tiny on-demand HTTP server (Node built-in http, no express) that runs the
 * Spotify Authorization Code flow for initial setup and for re-authorization
 * after the refresh token expires.
 *
 * It is started by node_helper only when authorization is required. The user
 * opens the server URL, is redirected to Spotify, signs in, and Spotify
 * redirects back to /callback on this server. The freshly obtained tokens are
 * written to the TokenStore and onSuccess() is invoked so the module recovers
 * in-process, without a restart.
 *
 * The redirect URI must match the value whitelisted in the Spotify app
 * dashboard. Spotify accepts http only for loopback addresses, which gives two
 * modes:
 *
 * - Loopback: redirectURI is http://127.0.0.1:<port>/callback. The server
 *   binds loopback only; the browser runs on the mirror or uses an SSH tunnel.
 * - Relay: redirectURI is an https relay page (docs/callback/). The server
 *   listens on the LAN at lanHost:lanPort and puts that address into `state`;
 *   the relay forwards the phone's browser back here. The state format must
 *   match docs/callback/relay.js.
 */

const http = require('http');
const { randomBytes } = require('crypto');

const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SCOPES = 'user-read-playback-state user-read-currently-playing';

const HTTP_TIMEOUT_MS = 15 * 1000;
const STATE_BYTES = 16;
const DEFAULT_HTTP_PORT = 80;
// Loopback mode binds loopback only: remote access goes through an SSH tunnel
// to the Pi's localhost. Relay mode has to be reachable from a phone.
const LOOPBACK_HOST = '127.0.0.1';
const LAN_HOST = '0.0.0.0';
// Fixed by the relay page, which always forwards to this path.
const RELAY_CALLBACK_PATH = '/callback';

const STATUS_OK = 200;
const STATUS_FOUND = 302;
const STATUS_BAD_REQUEST = 400;
const STATUS_NOT_FOUND = 404;
const STATUS_SERVER_ERROR = 500;


module.exports = class SpotifyAuthServer {

  /**
   * @param {object} options
   * @param {object} options.credentials { clientID, clientSecret }
   * @param {string} options.redirectURI Whitelisted redirect URI.
   * @param {TokenStore} options.store
   * @param {function} options.onSuccess Called after tokens are stored.
   * @param {function} [options.log] Logger (message) => void.
   * @param {string} [options.lanHost] Relay mode: the mirror's LAN address.
   * @param {number} [options.lanPort] Relay mode: port to listen on.
   */
  constructor(options) {
    this.credentials = options.credentials;
    this.redirectURI = options.redirectURI;
    this.store = options.store;
    this.onSuccess = options.onSuccess;
    this.log = options.log || function () {};

    const url = new URL(this.redirectURI);
    this.relay = SpotifyAuthServer.isRelayURI(this.redirectURI);

    if (this.relay) {
      this.lanHost = options.lanHost;
      this.port = options.lanPort;
      this.listenHost = LAN_HOST;
      this.callbackPath = RELAY_CALLBACK_PATH;
      this.entryURL = 'http://' + this.lanHost + ':' + this.port + '/';
    } else {
      this.port = url.port ? Number(url.port) : DEFAULT_HTTP_PORT;
      this.listenHost = LOOPBACK_HOST;
      this.callbackPath = url.pathname;
      this.entryURL = url.origin + '/';
    }

    this.server = null;
    this.pendingState = null;
  }

  /**
   * @param {string} redirectURI
   * @returns {boolean} True if the URI points to an https relay page.
   */
  static isRelayURI(redirectURI) {
    return new URL(redirectURI).protocol === 'https:';
  }

  isRunning() {
    return this.server !== null;
  }

  /**
   * @returns {boolean} True if the entry URL is meant to be opened on a phone.
   */
  isRelayMode() {
    return this.relay;
  }

  /**
   * @returns {string} URL the user should open in a browser to (re-)authorize.
   */
  getEntryURL() {
    return this.entryURL;
  }

  start() {
    if (this.server) {
      return;
    }

    const server = http.createServer((req, res) => this._handle(req, res));
    // A failed bind (e.g. EADDRINUSE) must not leave the server marked as
    // running, otherwise start() is never retried. The identity check keeps a
    // late error of a stopped server from clearing its successor.
    server.on('error', (err) => {
      this.log('Auth server error on port ' + this.port + ': ' + err.message);
      if (this.server === server) {
        this.server = null;
      }
    });
    this.server = server;
    this.server.listen(this.port, this.listenHost, () => {
      this.log('Authorization server listening on ' + this.entryURL);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.pendingState = null;
    }
  }

  _handle(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, this.entryURL);
    } catch {
      this._sendHtml(res, STATUS_BAD_REQUEST, this._page('Bad request', 'Malformed request URL.'));
      return;
    }

    if (requestUrl.pathname === '/') {
      this._handleRoot(res);
      return;
    }

    if (requestUrl.pathname === this.callbackPath) {
      // An unhandled rejection would terminate the MagicMirror process.
      this._handleCallback(requestUrl, res)
        .catch((err) => this.log('Callback handling failed: ' + err.message));
      return;
    }

    this._sendHtml(res, STATUS_NOT_FOUND, this._page('Not found', 'Unknown path.'));
  }

  _handleRoot(res) {
    this.pendingState = this._newState();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.credentials.clientID,
      scope: SCOPES,
      redirect_uri: this.redirectURI,
      state: this.pendingState
    });

    // Each visit issues a new state, so a cached redirect would carry a stale one.
    res.writeHead(STATUS_FOUND, {
      'Location': AUTHORIZE_ENDPOINT + '?' + params.toString(),
      'Cache-Control': 'no-store'
    });
    res.end();
  }

  _newState() {
    if (!this.relay) {
      return randomBytes(STATE_BYTES).toString('hex');
    }

    const payload = {
      h: this.lanHost,
      p: this.port,
      n: randomBytes(STATE_BYTES).toString('base64url')
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  async _handleCallback(requestUrl, res) {
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');

    if (!state || state !== this.pendingState) {
      this._sendHtml(res, STATUS_BAD_REQUEST,
        this._page('Authorization failed', 'State mismatch - please start again from the beginning.'));
      return;
    }
    this.pendingState = null;

    if (!code) {
      this._sendHtml(res, STATUS_BAD_REQUEST,
        this._page('Authorization failed', 'No authorization code was returned by Spotify.'));
      return;
    }

    try {
      const tokens = await this._exchangeCode(code);
      this.store.updateFromAuth(tokens, new Date());
      this.log('Authorization successful - tokens stored.');
      this._sendHtml(res, STATUS_OK,
        this._page('All set!', 'MagicMirror is authorized. You can close this tab; the mirror updates automatically.'));

      if (typeof this.onSuccess === 'function') {
        this.onSuccess();
      }
    } catch (err) {
      this.log('Token exchange failed: ' + err.message);
      this._sendHtml(res, STATUS_SERVER_ERROR,
        this._page('Authorization failed', 'Could not exchange the authorization code. Please try again.'));
    }
  }

  async _exchangeCode(code) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: this.redirectURI
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + this._basicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString(),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error('Token endpoint returned status ' + response.status);
    }

    return response.json();
  }

  _basicAuth() {
    return Buffer
      .from(this.credentials.clientID + ':' + this.credentials.clientSecret)
      .toString('base64');
  }

  _sendHtml(res, status, html) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  _page(title, bodyHtml) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + title + ' - MMM-NowPlayingOnSpotify</title>' +
      '<style>' +
      'body{font-family:sans-serif;background:#191414;color:#fff;margin:0;padding:2rem;text-align:center;}' +
      'h1{color:#1db954;}' +
      '</style></head><body>' +
      '<h1>' + title + '</h1>' + bodyHtml +
      '</body></html>';
  }
};
