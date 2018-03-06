'use strict';

const NodeHelper = require('node_helper');
const SpotifyConnector = require('./core/SpotifyConnector');


module.exports = NodeHelper.create({

  start: function () {
    this.connector = undefined;
  },


  socketNotificationReceived: function (notification, payload) {
    switch (notification) {
      case 'CONNECT_TO_SPOTIFY':
        this.connector = new SpotifyConnector(payload);
        this.retrieveCurrentSong();
        break;
    }
  },


  retrieveCurrentSong: function () {
    this.connector.retrieveCurrentlyPlaying()
      .then((response) => {
        this.sendRetrievedNotification(response);
      })
      .catch((error) => {
        // access token expired
        if (error.statusCode === 401) {
          console.log('Access token expired. Refreshing...');
          this.connector.refreshAccessToken(this.retrieveCurrentSong);
        } else {
          console.error('Can’t retrieve current song. Reason: ');
          console.error(error.message);
        }

      });
  },


  sendRetrievedNotification: function (originalResponse) {
    let payload = {
      imgURL: this.getImgURL(originalResponse.item.album.images),
      songTitle: originalResponse.item.name,
      artist: this.getArtistName(originalResponse.item.artists),
      album: originalResponse.item.album.name,
      titleLength: originalResponse.item.duration_ms,
      progress: originalResponse.progress_ms,
      isPlaying: originalResponse.isPlaying,
      deviceName: originalResponse.device.name
    };

    this.sendSocketNotification('RETRIEVED_SONG_DATA', payload);
  },


  getArtistName: function (artists) {
    return artists.map((artist) => {
      return artist.name;
    }).join(', ');
  },


  getImgURL(images) {
    let filtered = images.filter((image) => {
      return image.width >= 240 && image.width <= 350;
    });

    return filtered[0].url;
  }
});
