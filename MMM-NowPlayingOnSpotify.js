'use strict';

/* MMM-NowPlayingOnSpotify - frontend
 *
 * Pure display: sends the config once, then renders whatever the backend
 * pushes. No polling timer here (the backend owns the poll cycle); between
 * polls, only the playback progress is counted on locally.
 */

// Fade duration when the module hides or shows itself after hideAfter.
const NPOS_HIDE_FADE_MS = 1000;
// Between polls, time and progress bar move on at this interval.
const NPOS_PROGRESS_TICK_MS = 1000;

Module.register('MMM-NowPlayingOnSpotify', {

  // default values
  defaults: {
    // Module misc
    name: 'MMM-NowPlayingOnSpotify',
    hidden: false,

    // user definable
    updatesEvery: 3,          // Interval in s for querying Spotify during playback
    idleAfter: 30,            // Seconds without playback before polling slows down
    idleUpdatesEvery: 10,     // Polling interval in s while nothing is playing
    hideAfter: 0,             // Seconds without playback before the module hides, 0 = never
    showCoverArt: true,       // Do you want the cover art to be displayed?
    coverShadow: true,        // Lift the cover off the background with a shadow
    coverGlow: false,         // Surround the cover with a blurred glow in its colors
    scrollLongText: true,     // Scroll lines wider than the module instead of cutting them off
    redirectURI: '',          // Whitelisted Spotify redirect URI for (re-)authorization
    authHost: '',             // Relay mode: mirror's LAN address, detected if empty
    authPort: 8888            // Relay mode: port of the authorization server
  },


  start: function () {
    Log.info('Starting module: ' + this.name);

    this.initialized = false;
    this.authRequired = false;
    this.context = {};
    this.authInfo = null;
    this.hiddenWhileIdle = false;
    // What getDom() rendered last, so a poll for the same track can update
    // it in place instead of rebuilding the cover.
    this.renderedDom = null;
    this.renderedLayoutKey = null;
    this.lineObserver = null;
    // Progress as last reported by Spotify and when it arrived; the tick
    // counts on from there until the next poll resets it.
    this.progressBase = 0;
    this.progressReceivedAt = 0;
    this.progressTimer = null;
    this.suspended = false;

    // Send the config once - the backend takes over from here.
    this.sendSocketNotification('CONNECT_TO_SPOTIFY', this.config);
  },

  getTranslations: function () {
    return {
      en: 'translations/en.json',
      de: 'translations/de.json'
    };
  },

  getDom: function () {
    let domBuilder = this.getDomBuilder();
    this.renderedLayoutKey = null;

    if (this.authRequired) {
      this.renderedDom = domBuilder.getReauthDom(this.authInfo);
    } else if (this.initialized) {
      this.renderedDom = domBuilder.getDom(this.context);
      this.renderedLayoutKey = domBuilder.getLayoutKey(this.context);
    } else {
      this.renderedDom = domBuilder.getInitDom(this.translate('LOADING'));
    }

    this.watchLongLines(domBuilder);

    return this.renderedDom;
  },

  /**
   * Whether a line overflows is only known once it is laid out. The
   * observer measures the lines when the info area gets its size in the
   * document and again whenever its width changes, e.g. after the module
   * was shown again or custom.css resized it.
   */
  watchLongLines: function (domBuilder) {
    if (this.lineObserver) {
      this.lineObserver.disconnect();
      this.lineObserver = null;
    }

    let infoArea = this.renderedDom.querySelector('.NPOS_infoArea');
    if (!this.config.scrollLongText || !infoArea) {
      return;
    }

    this.lineObserver = new ResizeObserver(() => domBuilder.scrollLongLines(infoArea));
    this.lineObserver.observe(infoArea);
  },

  getDomBuilder: function () {
    return new NPOS_DomBuilder(this.config, this.file(''), this.translate.bind(this));
  },

  /**
   * updateDom() replaces the module's whole content, which would rasterize
   * the cover's blurred glow again on every poll and restart the scrolling
   * lines. While the same track plays, only time, play state and progress
   * change, so they are updated in place.
   */
  showSongData: function () {
    let domBuilder = this.getDomBuilder();
    let unchanged = this.renderedLayoutKey !== null
      && this.renderedLayoutKey === domBuilder.getLayoutKey(this.context);

    if (unchanged && domBuilder.updateInfoArea(this.renderedDom, this.context)) {
      return;
    }

    this.updateDom();
  },

  getStyles: function () {
    return [
      this.file('css/styles.css'),
      'font-awesome.css'
    ];
  },

  getScripts: function () {
    return [
      this.file('vendor/qrcode-generator/qrcode.js'),
      this.file('core/NPOS_DomBuilder.js')
    ];
  },

  socketNotificationReceived: function (notification, payload) {
    switch (notification) {
      case 'RETRIEVED_SONG_DATA':
        this.initialized = true;
        this.authRequired = false;
        // A copy, since the tick moves its progress on.
        this.context = { ...payload };
        this.progressBase = payload.progress;
        this.progressReceivedAt = Date.now();
        this.showSongData();
        this.setHiddenWhileIdle(payload.hideWhileIdle);
        this.restartProgressTick();
        break;

      case 'SPOTIFY_AUTH_REQUIRED':
        this.initialized = true;
        this.authRequired = true;
        this.authInfo = payload;
        this.updateDom();
        // The re-authorization banner must be visible to be acted on.
        this.setHiddenWhileIdle(false);
        this.restartProgressTick();
        break;
    }
  },

  // MagicMirror calls suspend() once the module has faded out and resume()
  // once it has faded in again.
  suspend: function () {
    this.suspended = true;
    this.restartProgressTick();
  },

  resume: function () {
    this.suspended = false;
    this.restartProgressTick();
    if (this.progressTimer) {
      this.advanceProgress();
    }
  },

  /**
   * Polls may be several seconds apart, so time and progress bar are moved
   * on in between. Only while a track plays on a visible module; Spotify's
   * next report replaces the estimate.
   */
  restartProgressTick: function () {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }

    let running = this.initialized && !this.authRequired && !this.suspended
      && !this.hiddenWhileIdle && !this.context.noSong && this.context.isPlaying
      && this.context.titleLength > 0;
    if (running) {
      this.progressTimer = setInterval(() => this.advanceProgress(), NPOS_PROGRESS_TICK_MS);
    }
  },

  advanceProgress: function () {
    let elapsed = Date.now() - this.progressReceivedAt;
    this.context.progress = Math.min(this.progressBase + elapsed, this.context.titleLength);

    let updated = this.getDomBuilder().updateInfoArea(this.renderedDom, this.context);
    if (!updated || this.context.progress >= this.context.titleLength) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  },

  /**
   * The lock string keeps the module hidden while another module (e.g. a
   * pages module) shows it, and lets those modules hide it independently.
   */
  setHiddenWhileIdle: function (hide) {
    if (Boolean(hide) === this.hiddenWhileIdle) {
      return;
    }
    this.hiddenWhileIdle = Boolean(hide);

    const options = { lockString: this.identifier };
    if (this.hiddenWhileIdle) {
      this.hide(NPOS_HIDE_FADE_MS, () => {}, options);
    } else {
      this.show(NPOS_HIDE_FADE_MS, () => {}, options);
    }
  }
});
