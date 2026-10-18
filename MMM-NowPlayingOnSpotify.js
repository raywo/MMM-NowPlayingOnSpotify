'use strict';

/* MMM-NowPlayingOnSpotify - frontend
 *
 * Pure display: sends the config once, then renders whatever the backend
 * pushes. No polling timer here (the backend owns the poll cycle).
 */

Module.register('MMM-NowPlayingOnSpotify', {

  // default values
  defaults: {
    // Module misc
    name: 'MMM-NowPlayingOnSpotify',
    hidden: false,

    // user definable
    updatesEvery: 1,          // How often should the table be updated in s?
    showCoverArt: true,       // Do you want the cover art to be displayed?
    redirectURI: ''           // Whitelisted Spotify redirect URI for (re-)authorization
  },


  start: function () {
    Log.info('Starting module: ' + this.name);

    this.initialized = false;
    this.authRequired = false;
    this.context = {};
    this.authInfo = null;

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
        break;

      case 'SPOTIFY_AUTH_REQUIRED':
        this.initialized = true;
        this.authRequired = true;
        this.authInfo = payload;
        this.updateDom();
        break;
    }
  }
});
