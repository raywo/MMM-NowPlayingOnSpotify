'use strict';

/* MMM-NowPlayingOnSpotify - node_helper
 *
 * Backend owns the poll cycle (self-rescheduling setTimeout) and the whole
 * token lifecycle; the frontend is pure display. On invalid_grant the poll
 * loop stops, an integrated auth server is started and the mirror is told to
 * show a re-authorization banner. After a successful re-auth the module
 * recovers in-process, without a restart.
 *
 * Architecture rule: backend polls, frontend shows. On transient errors the
 * last good payload is kept (frontend never blanks).
 */

const NodeHelper = require('node_helper');
const SpotifyConnector = require('./core/SpotifyConnector');
const TokenStore = require('./core/TokenStore');
const SpotifyAuthServer = require('./core/SpotifyAuthServer');
const { resolveAuthAddress } = require('./core/LanAddress');

const AuthRequiredError = SpotifyConnector.AuthRequiredError;
const RateLimitError = SpotifyConnector.RateLimitError;

const MS_PER_SECOND = 1000;
const DEFAULT_UPDATE_INTERVAL_S = 1;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

// Idle polling: once nothing has played for a while, poll less often to spare
// the Pi, the network and Spotify's rate limit, which counts per app.
const DEFAULT_IDLE_AFTER_S = 30;
const DEFAULT_IDLE_UPDATE_INTERVAL_S = 10;

// Failures are reported on the mirror only once the shown data would be at
// least this old before the next attempt; brief hiccups stay invisible.
const STALE_AFTER_MS = 60 * MS_PER_SECOND;

// Proactive re-auth warning: Spotify refresh tokens live ~6 months from the
// original authorization; warn before the hard expiry so it is never a surprise.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_DAYS = 182;
const REAUTH_WARNING_LEAD_DAYS = 14;

// While authorization is pending and the auth server could not start (e.g. no
// LAN address yet at boot), try again at this interval.
const AUTH_RETRY_INTERVAL_MS = 30 * MS_PER_SECOND;

// Album cover selection: prefer a mid-sized image for the mirror.
const COVER_MIN_WIDTH = 240;
const COVER_MAX_WIDTH = 350;


module.exports = NodeHelper.create({

  start: function () {
    this.config = null;
    this.store = null;
    this.credentials = null;
    this.connector = null;
    this.authServer = null;
    // Translation key explaining why authServer is null.
    this.authUnavailableReason = null;
    this.authRetryTimer = null;

    this.authRequired = false;
    this.pollTimer = null;
    this.inFlight = false;
    this.lastPayload = null;
    // Start of the current stretch without playback, null while playing.
    this.idleSince = null;
    this.idle = false;
    // Start of the current run of failed polls, null while polls succeed.
    this.failingSince = null;
    // Shown on the mirror while the data is stale: { reason, retryAt }.
    this.unavailable = null;
  },


  socketNotificationReceived: function (notification, payload) {
    if (notification === 'CONNECT_TO_SPOTIFY') {
      this.handleConnect(payload);
    }
  },


  handleConnect: function (config) {
    this.config = config;
    this.initOnce();

    // Browser reload while re-authorization is pending: keep the state, re-notify.
    // Restart the auth server in case its earlier bind failed.
    if (this.authRequired) {
      this.ensureAuthServerRunning();
      this.sendAuthRequired();
      return;
    }

    // Browser reload during normal operation: show cached data immediately.
    if (this.lastPayload || this.unavailable) {
      this.sendSongData();
    }

    this.startPolling();
  },


  initOnce: function () {
    if (this.store) {
      return;
    }

    this.credentials = {
      clientID: this.config.clientID,
      clientSecret: this.config.clientSecret
    };

    this.store = new TokenStore(this.path);
    this.store.load();
    this.store.seedFromConfig(this.config);

    this.connector = new SpotifyConnector(this.credentials, this.store);

    if (!this.config.redirectURI) {
      this.log('No redirectURI configured - re-authorization flow is unavailable.');
      this.authUnavailableReason = 'REAUTH_NO_REDIRECT';
    }
  },


  /**
   * Created only when it is about to start: in relay mode the LAN address goes
   * into the QR code, and the mirror may have had none at startup or a
   * different one since. Do not create it once in initOnce().
   */
  createAuthServer: function () {
    const redirectURI = this.config.redirectURI;
    const options = {
      credentials: this.credentials,
      redirectURI: redirectURI,
      store: this.store,
      onSuccess: () => this.handleAuthSuccess(),
      log: (message) => this.log(message)
    };

    if (SpotifyAuthServer.isRelayURI(redirectURI)) {
      const address = resolveAuthAddress(this.config);
      if (address.error) {
        // Called on every poll during the warning window: log changes only.
        if (this.authUnavailableReason !== address.error) {
          this.log(address.message);
        }
        this.authUnavailableReason = address.error;
        return null;
      }
      options.lanHost = address.host;
      options.lanPort = address.port;
    }

    this.authUnavailableReason = null;
    return new SpotifyAuthServer(options);
  },


  startPolling: function () {
    if (this.inFlight || this.pollTimer) {
      return;
    }
    this.poll();
  },


  scheduleNextPoll: function (delayMs) {
    if (this.authRequired) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.poll();
    }, delayMs);
  },


  poll: async function () {
    this.inFlight = true;
    let delayMs = this.updateIntervalMs();

    try {
      const data = await this.connector.retrieveCurrentlyPlaying();
      const authURL = this.authURLForWarning();
      const payload = this.buildPayload(data, authURL);
      this.lastPayload = payload;
      this.noteRecovery();
      this.updateIdleState(this.isPlaying(data));
      this.sendSongData();
      delayMs = this.updateIntervalMs();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        this.inFlight = false;
        this.enterAuthRequired();
        return;
      }
      // Transient: keep last good data, retry later.
      if (error.retryAfterMs) {
        delayMs = error.retryAfterMs;
      }
      this.log('Transient error, retrying in ' + this.formatDelay(delayMs)
        + ', keeping last data: ' + error.message);
      this.noteFailure(error, delayMs);
    }

    this.inFlight = false;
    this.scheduleNextPoll(delayMs);
  },


  enterAuthRequired: function () {
    this.authRequired = true;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.ensureAuthServerRunning();

    this.log('Re-authorization required - poll loop paused, auth server active.');
    this.sendAuthRequired();
    this.scheduleAuthRetry();
  },


  /**
   * The poll loop is paused while authorization is pending, so nothing else
   * would retry a failed auth server start. Without a redirectURI there is
   * nothing to retry.
   */
  scheduleAuthRetry: function () {
    if (!this.authRequired || this.authServer || this.authRetryTimer || !this.config.redirectURI) {
      return;
    }
    this.authRetryTimer = setTimeout(() => {
      this.authRetryTimer = null;
      if (!this.authRequired) {
        return;
      }
      this.ensureAuthServerRunning();
      if (this.authServer) {
        this.sendAuthRequired();
      } else {
        this.scheduleAuthRetry();
      }
    }, AUTH_RETRY_INTERVAL_MS);
  },


  ensureAuthServerRunning: function () {
    if (!this.config.redirectURI || (this.authServer && this.authServer.isRunning())) {
      return;
    }

    this.authServer = this.createAuthServer();
    if (this.authServer) {
      this.authServer.start();
    }
  },


  /**
   * During the proactive warning window the auth server is started so the user
   * can re-authorize BEFORE the hard expiry. Returns the URL to show, or null.
   */
  authURLForWarning: function () {
    if (!this.isReauthWarningDue()) {
      return null;
    }
    this.ensureAuthServerRunning();
    return this.authServer ? this.authServer.getEntryURL() : null;
  },


  handleAuthSuccess: function () {
    this.authRequired = false;

    if (this.authRetryTimer) {
      clearTimeout(this.authRetryTimer);
      this.authRetryTimer = null;
    }

    if (this.authServer && this.authServer.isRunning()) {
      this.authServer.stop();
    }

    this.log('Re-authorization complete - resuming poll loop.');
    this.startPolling();
  },


  sendAuthRequired: function () {
    this.sendSocketNotification('SPOTIFY_AUTH_REQUIRED', {
      authURL: this.authServer ? this.authServer.getEntryURL() : null,
      authRelay: this.isAuthRelay(),
      authUnavailableReason: this.authUnavailableReason
    });
  },


  isAuthRelay: function () {
    return this.authServer ? this.authServer.isRelayMode() : false;
  },


  /**
   * @param {object|null} data Raw Spotify player payload, or null for noSong.
   * @returns {object} Frontend payload.
   */
  buildPayload: function (data, authURL) {
    const reauthWarning = this.isReauthWarningDue();
    const warnURL = reauthWarning ? (authURL || null) : null;
    const warnReason = reauthWarning ? this.authUnavailableReason : null;

    const authRelay = this.isAuthRelay();

    if (!data || !data.item) {
      return {
        noSong: true,
        reauthWarning: reauthWarning,
        authURL: warnURL,
        authRelay: authRelay,
        authUnavailableReason: warnReason
      };
    }

    return {
      imgURL: this.getImgURL(data.item.album.images),
      songTitle: data.item.name,
      artist: this.getArtistName(data.item.artists),
      album: data.item.album.name,
      titleLength: data.item.duration_ms,
      progress: data.progress_ms,
      isPlaying: data.is_playing,
      deviceName: data.device ? data.device.name : '',
      reauthWarning: reauthWarning,
      authURL: warnURL,
      authRelay: authRelay,
      authUnavailableReason: warnReason
    };
  },


  isReauthWarningDue: function () {
    const obtainedAt = this.store.getRefreshTokenObtainedAt();
    if (!obtainedAt) {
      return false;
    }

    const ageMs = Date.now() - obtainedAt.getTime();
    const thresholdMs = (REFRESH_TOKEN_LIFETIME_DAYS - REAUTH_WARNING_LEAD_DAYS) * MS_PER_DAY;
    return ageMs >= thresholdMs;
  },


  noteRecovery: function () {
    if (this.failingSince !== null) {
      this.log('Spotify reachable again - showing current data.');
    }
    this.failingSince = null;
    this.unavailable = null;
  },


  noteFailure: function (error, delayMs) {
    const now = Date.now();
    if (this.failingSince === null) {
      this.failingSince = now;
    }

    if (now + delayMs - this.failingSince < STALE_AFTER_MS) {
      return;
    }

    this.unavailable = {
      reason: error instanceof RateLimitError ? 'RATE_LIMITED' : 'UNREACHABLE',
      retryAt: now + delayMs
    };
    this.sendSongData();
  },


  /**
   * Sends the last good data, marked as stale while Spotify is unavailable.
   * Without any data yet, the stale report goes with a nothing-playing payload.
   * Computed per send so a browser reload restores whether the module hides.
   */
  sendSongData: function () {
    let payload = Object.assign({}, this.lastPayload || this.buildPayload(null, null), {
      hideWhileIdle: this.shouldHideWhileIdle()
    });
    if (this.unavailable) {
      payload.unavailable = this.unavailable;
    }
    this.sendSocketNotification('RETRIEVED_SONG_DATA', payload);
  },


  /**
   * Ads and podcast episodes arrive without an item but still play;
   * they must not slow down polling for the song that follows.
   */
  isPlaying: function (data) {
    return Boolean(data && data.is_playing);
  },


  /**
   * Paused counts as idle: the mirror shows nothing new until playback
   * resumes, and resuming is noticed within one idle interval.
   */
  updateIdleState: function (playing) {
    if (playing) {
      const wasIdle = this.idle;
      this.idleSince = null;
      this.idle = false;
      if (wasIdle) {
        this.log('Playback resumed - polling every ' + this.formatDelay(this.updateIntervalMs()) + '.');
      }
      return;
    }

    if (this.idleSince === null) {
      this.idleSince = Date.now();
    }

    const idleAfterMs = (Number(this.config.idleAfter) || DEFAULT_IDLE_AFTER_S) * MS_PER_SECOND;
    if (!this.idle && Date.now() - this.idleSince >= idleAfterMs) {
      this.idle = true;
      this.log('Nothing playing for ' + this.formatDelay(idleAfterMs)
        + ' - polling every ' + this.formatDelay(this.updateIntervalMs()) + '.');
    }
  },


  /**
   * hideAfter is opt-in: without it, the module never hides on its own.
   * The stale-data banner must be visible to explain an empty mirror.
   */
  shouldHideWhileIdle: function () {
    const hideAfterSeconds = Number(this.config.hideAfter) || 0;
    if (hideAfterSeconds <= 0 || this.idleSince === null || this.unavailable) {
      return false;
    }
    return Date.now() - this.idleSince >= hideAfterSeconds * MS_PER_SECOND;
  },


  updateIntervalMs: function () {
    const activeSeconds = Number(this.config.updatesEvery) || DEFAULT_UPDATE_INTERVAL_S;
    if (!this.idle) {
      return activeSeconds * MS_PER_SECOND;
    }

    const idleSeconds = Number(this.config.idleUpdatesEvery) || DEFAULT_IDLE_UPDATE_INTERVAL_S;
    return Math.max(activeSeconds, idleSeconds) * MS_PER_SECOND;
  },


  formatDelay: function (delayMs) {
    const totalSeconds = Math.round(delayMs / MS_PER_SECOND);
    if (totalSeconds < SECONDS_PER_MINUTE) {
      return totalSeconds + ' s';
    }

    const totalMinutes = Math.round(totalSeconds / SECONDS_PER_MINUTE);
    if (totalMinutes < MINUTES_PER_HOUR) {
      return totalMinutes + ' min';
    }

    const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    const minutes = totalMinutes % MINUTES_PER_HOUR;
    return minutes ? hours + ' h ' + minutes + ' min' : hours + ' h';
  },


  getArtistName: function (artists) {
    return artists.map((artist) => artist.name).join(', ');
  },


  getImgURL: function (images) {
    if (!images || images.length === 0) {
      return '';
    }

    const preferred = images.filter((image) =>
      image.width >= COVER_MIN_WIDTH && image.width <= COVER_MAX_WIDTH);

    return (preferred[0] || images[0]).url;
  },


  log: function (message) {
    console.log('[MMM-NowPlayingOnSpotify] ' + message);
  }
});
