'use strict';

/* MMM-NowPlayingOnSpotify - relay browser test
 *
 * Checks whether a browser follows the HTTPS relay page back to a private LAN
 * address, without involving Spotify. Run it on any computer in the LAN:
 *
 *   node scripts/relay-test-server.js [lan-address] [port]
 *
 * Then open the printed URL on a phone in the same network and tap the link.
 * The phone visits the relay page with a fake code; if the browser lets the
 * relay navigate back, this server shows "Relay works" and logs the request.
 *
 * RELAY_URL overrides the relay page, e.g. for a self-hosted copy.
 */

const http = require('http');
const os = require('os');
const { randomBytes } = require('crypto');

const DEFAULT_RELAY_URL = 'https://raywo.github.io/MMM-NowPlayingOnSpotify/callback/';
const DEFAULT_PORT = 8888;
const NONCE_BYTES = 16;

const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_NOT_FOUND = 404;


function detectLanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  return '127.0.0.1';
}

function encodeState(host, port, nonce) {
  return Buffer.from(JSON.stringify({ h: host, p: port, n: nonce })).toString('base64url');
}

function page(title, bodyHtml) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>body{font-family:sans-serif;padding:2rem;text-align:center;}</style>' +
    '</head><body><h1>' + title + '</h1>' + bodyHtml + '</body></html>';
}

function send(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
}

// Tells the automatic forward apart from a tap on the relay's fallback link,
// which would hide that the browser blocked the forward.
function describeNavigation(headers) {
  if (!headers['sec-fetch-mode']) {
    return 'unknown (browser sends no Fetch Metadata)';
  }
  return headers['sec-fetch-user'] === '?1' ? 'after tapping the fallback link' : 'automatic';
}


const host = process.argv[2] || detectLanAddress();
const port = Number(process.argv[3]) || DEFAULT_PORT;
const relayURL = process.env.RELAY_URL || DEFAULT_RELAY_URL;
const issuedStates = new Set();

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, 'http://' + host + ':' + port);

  if (requestUrl.pathname === '/') {
    const state = encodeState(host, port, randomBytes(NONCE_BYTES).toString('base64url'));
    issuedStates.add(state);
    const target = relayURL + '?' + new URLSearchParams({ code: 'relay-test', state: state }).toString();
    send(res, STATUS_OK, page('Relay browser test',
      '<p>Tap the link. You should land back on this server.</p>' +
      '<p><a href="' + escapeHtml(target) + '">Start relay test</a></p>'));
    return;
  }

  if (requestUrl.pathname === '/callback') {
    const state = requestUrl.searchParams.get('state');
    const userAgent = req.headers['user-agent'] || 'unknown';
    if (!issuedStates.has(state)) {
      console.log('Callback with unknown state from ' + userAgent);
      send(res, STATUS_BAD_REQUEST, page('Unknown state', '<p>Start again from the first page.</p>'));
      return;
    }
    issuedStates.delete(state);
    const navigation = describeNavigation(req.headers);
    console.log('Relay works, forward ' + navigation + ': ' + userAgent);
    send(res, STATUS_OK, page('Relay works',
      '<p>The browser followed the relay back to the LAN.</p>' +
      '<p>Forward: ' + escapeHtml(navigation) + '</p>' +
      '<p><small>' + escapeHtml(userAgent) + '</small></p>'));
    return;
  }

  send(res, STATUS_NOT_FOUND, page('Not found', ''));
});

server.listen(port, '0.0.0.0', () => {
  console.log('Relay: ' + relayURL);
  console.log('Open on a phone in the same network: http://' + host + ':' + port + '/');
});
