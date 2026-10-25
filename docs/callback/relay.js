'use strict';

/* MMM-NowPlayingOnSpotify - Spotify redirect relay
 *
 * Spotify accepts http redirect URIs only for loopback addresses, so a phone
 * cannot be sent straight back to the mirror on the LAN. This static page is
 * registered as the HTTPS redirect URI instead. It reads the mirror's address
 * from the OAuth `state` parameter and forwards the browser, with the query
 * string unchanged, to http://<mirror>:<port>/callback.
 *
 * The page only ever sees the authorization code, never tokens; the code is
 * worthless without the client secret that stays on the mirror. It forwards
 * to private IPv4 addresses only, so it cannot be used as an open redirect.
 * Do not widen that check to hostnames: a name can resolve to any address.
 *
 * State format: base64url(JSON.stringify({ h: host, p: port, n: nonce })).
 */

const CALLBACK_PATH = '/callback';
const MIN_NONCE_LENGTH = 16;
const NONCE_PATTERN = /^[A-Za-z0-9_-]+$/;
// Dotted quad without leading zeros, so no octal or shorthand forms slip by.
const IPV4_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const MAX_PORT = 65535;


function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  return atob(padded);
}

/**
 * @param {string} host
 * @returns {boolean} True for RFC 1918, link-local and loopback IPv4 addresses.
 */
function isPrivateIPv4(host) {
  const match = IPV4_PATTERN.exec(host);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) {
    return false;
  }

  const [a, b] = octets;
  return a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 127;
}

/**
 * @param {string} state Raw `state` query parameter.
 * @returns {{host: string, port: number}|null} The mirror address, or null if
 *   the state is malformed or does not name a private address.
 */
function parseState(state) {
  if (typeof state !== 'string' || state === '') {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(state));
  } catch {
    return null;
  }

  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const { h: host, p: port, n: nonce } = payload;
  if (typeof host !== 'string' || !isPrivateIPv4(host)) {
    return null;
  }
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    return null;
  }
  if (typeof nonce !== 'string' || nonce.length < MIN_NONCE_LENGTH || !NONCE_PATTERN.test(nonce)) {
    return null;
  }

  return { host: host, port: port };
}

/**
 * @param {string} search The relay page's query string, including the "?".
 * @returns {string|null} URL on the mirror to forward to, or null.
 */
function buildTarget(search) {
  const params = new URLSearchParams(search);
  const address = parseState(params.get('state'));
  if (!address) {
    return null;
  }

  return 'http://' + address.host + ':' + address.port + CALLBACK_PATH + '?' + params.toString();
}

function relay() {
  const target = buildTarget(window.location.search);
  const status = document.getElementById('status');

  if (!target) {
    status.textContent = 'This link does not point to a MagicMirror in your local network. ' +
      'Please start the authorization again from the mirror.';
    return;
  }

  const link = document.getElementById('fallback');
  link.href = target;
  link.hidden = false;
  // replace() keeps the code out of the browser history.
  window.location.replace(target);
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isPrivateIPv4, parseState, buildTarget };
} else {
  relay();
}
