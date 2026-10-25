'use strict';

/* MMM-NowPlayingOnSpotify - frontend
 *
 * Pure display: sends the config once, then renders whatever the backend
 * pushes. No polling timer here (the backend owns the poll cycle).
 */

// Fade duration when the module hides or shows itself after hideAfter.
const NPOS_HIDE_FADE_MS = 1000;

Module.register('MMM-NowPlayingOnSpotify', {

  // default values
  defaults: {
    // Module misc
    name: 'MMM-NowPlayingOnSpotify',
    hidden: false,

    // user definable
    updatesEvery: 1,          // How often should the table be updated in s?
    idleAfter: 30,            // Seconds without playback before polling slows down
    idleUpdatesEvery: 10,     // Polling interval in s while nothing is playing
    hideAfter: 0,             // Seconds without playback before the module hides, 0 = never
    showCoverArt: true,       // Do you want the cover art to be displayed?
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
    let domBuilder = new NPOS_DomBuilder(this.config, this.file(''), this.translate.bind(this));

    if (this.authRequired) {
      return domBuilder.getReauthDom(this.authInfo);
    }

    if (this.initialized) {
      return domBuilder.getDom(this.context);
    }

    return domBuilder.getInitDom(this.translate('LOADING'));
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
        this.context = payload;
        this.updateDom();
        this.setHiddenWhileIdle(payload.hideWhileIdle);
        break;

      case 'SPOTIFY_AUTH_REQUIRED':
        this.initialized = true;
        this.authRequired = true;
        this.authInfo = payload;
        this.updateDom();
        // The re-authorization banner must be visible to be acted on.
        this.setHiddenWhileIdle(false);
        break;
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
