'use strict';

Module.register('MMM-NowPlayingOnSpotify', {

  // default values
  defaults: {
    // Module misc
    name: 'MMM-NowPlayingOnSpotify',
    hidden: false,

    // user definable
    updatesEvery: 1,          // How often should the table be updated in s?
    showCoverArt: true       // Do you want the cover art to be displayed?
  },


  start: function () {
    Log.info('Starting module: ' + this.name );

    this.initialized = false;
    this.context = {};

    this.startFetchingLoop();
  },

  getDom: function () {
    let domBuilder = new NPOS_DomBuilder(this.config, this.file(''));

    if (this.initialized) {
      return domBuilder.getDom(this.context);
    } else {
      return domBuilder.getInitDom(this.translate('LOADING'));
    }
  },

  getStyles: function () {
    return [
      this.file('css/styles.css'),
      this.file('node_modules/moment-duration-format/lib/moment-duration-format.js'),
      'font-awesome.css'
    ];
  },

  getScripts: function () {
    return [
      this.file('core/NPOS_DomBuilder.js'),
      'moment.js'
    ];
  },

  socketNotificationReceived: function (notification, payload) {
    switch (notification) {
      case 'RETRIEVED_SONG_DATA':
        this.initialized = true;
        this.context = payload;
        this.updateDom();
    }
  },

  startFetchingLoop() {
    // start immediately ...
    let credentials = {
      clientID: this.config.clientID,
      clientSecret: this.config.clientSecret,
      accessToken: this.config.accessToken,
      refreshToken: this.config.refreshToken
    };

    this.sendSocketNotification('CONNECT_TO_SPOTIFY', credentials);

    // ... and then repeat in the given interval
    setInterval(() => {
      this.sendSocketNotification('UPDATE_CURRENT_SONG');
    }, this.config.updatesEvery * 1000);
  }
});
