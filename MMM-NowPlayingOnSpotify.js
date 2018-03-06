'use strict';

Module.register('MMM-NowPlayingOnSpotify', {

  // default values
  defaults: {
    // Module misc
    name: 'MMM-NowPlayingOnSpotify',
    hidden: false,

    // user definable
    updatesEvery: 5,          // How often should the table be updated in s?
    showCoverArt: true       // Do you want the cover art to be displayed?
  },


  start: function () {
    Log.info('Starting module: ' + this.name );

    this.initialized = false;
    this.context = {};

    let credentials = {
      clientID: this.config.clientID,
      clientSecret: this.config.clientSecret,
      accessToken: this.config.accessToken,
      refreshToken: this.config.refreshToken,
      filePath: this.file('')
    };

    this.sendSocketNotification('CONNECT_TO_SPOTIFY', credentials);
  },

  getDom: function () {
    let domBuilder = new NPOS_DomBuilder(this.config, this.file(''));

    if (this.initialized) {
      /*let context = {
        imgURL: 'https://i.scdn.co/image/8c1e066b5d1045038437d92815d49987f519e44f',
        songTitle: 'Mr. Brightside',
        artist: 'The Killers The Killers The Killers The Killers ',
        album: 'Hot Fuss',
        titleLength: 222075,
        progress: 44272,
        isPlaying: false,
        deviceName: 'Rays iMac'
      };*/

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
      this.file('core/NPOS_DomBuilder.js')
    ];
  },

  socketNotificationReceived: function (notification, payload) {
    switch (notification) {
      case 'RETRIEVED_SONG_DATA':
        this.initialized = true;
        this.context = payload;
        Log.info(payload);
        this.updateDom(1000);
    }
  }
});
