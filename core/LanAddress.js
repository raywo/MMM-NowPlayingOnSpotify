'use strict';

/* MMM-NowPlayingOnSpotify - LanAddress
 *
 * Finds the mirror's address that a phone in the same network can reach, for
 * the relay authorization flow. Only addresses the relay page accepts count,
 * so the check is shared with docs/callback/relay.js instead of duplicated.
 */

const fs = require('fs');
const os = require('os');
const { isPrivateIPv4 } = require('../docs/callback/relay.js');

const LINK_LOCAL_PREFIX = '169.254.';
// Docker and Podman create these inside every container.
const CONTAINER_MARKERS = ['/.dockerenv', '/run/.containerenv'];
const DEFAULT_AUTH_PORT = 8888;
const MAX_PORT = 65535;


/**
 * @param {object} [interfaces] Result of os.networkInterfaces(), for tests.
 * @returns {string|null} A private IPv4 address, preferring routable ones over
 *   link-local; null if there is none.
 */
function detectLanAddress(interfaces) {
  const candidates = [];

  for (const addresses of Object.values(interfaces || os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal && isPrivateIPv4(address.address)) {
        candidates.push(address.address);
      }
    }
  }

  return candidates.find((address) => !address.startsWith(LINK_LOCAL_PREFIX)) ||
    candidates[0] ||
    null;
}


/**
 * @returns {boolean} True when running inside a Docker or Podman container.
 */
function isInContainer() {
  return CONTAINER_MARKERS.some((marker) => fs.existsSync(marker));
}


/**
 * Resolves where the auth server listens in relay mode. A configured authHost
 * must pass the relay's own check, otherwise the flow would only fail after
 * the user has logged in at Spotify. For the same reason a container needs
 * authHost: the detected address there is the container's own, which is
 * private but unreachable from a phone.
 *
 * @param {object} config Module config with optional authHost and authPort.
 * @param {object} [interfaces] Result of os.networkInterfaces(), for tests.
 * @param {boolean} [inContainer] Overrides container detection, for tests.
 * @returns {{host: string, port: number}|{error: string, message: string}}
 *   The address, or a translation key and a log message explaining its absence.
 */
function resolveAuthAddress(config, interfaces, inContainer) {
  const port = Number(config.authPort) || DEFAULT_AUTH_PORT;
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    return {
      error: 'REAUTH_INVALID_AUTH_PORT',
      message: 'authPort ' + config.authPort + ' is not a valid port - authorization is unavailable.'
    };
  }

  if (config.authHost) {
    if (!isPrivateIPv4(config.authHost)) {
      return {
        error: 'REAUTH_INVALID_AUTH_HOST',
        message: 'authHost ' + config.authHost + ' is not a private IPv4 address - authorization is unavailable.'
      };
    }
    return { host: config.authHost, port: port };
  }

  if (inContainer === undefined ? isInContainer() : inContainer) {
    return {
      error: 'REAUTH_CONTAINER_NEEDS_AUTH_HOST',
      message: 'Running in a container - set authHost in config.js to the host\'s LAN address.'
    };
  }

  const host = detectLanAddress(interfaces);
  if (!host) {
    return {
      error: 'REAUTH_NO_LAN_ADDRESS',
      message: 'No LAN address found - set authHost in config.js to enable authorization.'
    };
  }
  return { host: host, port: port };
}


module.exports = { detectLanAddress, resolveAuthAddress };
