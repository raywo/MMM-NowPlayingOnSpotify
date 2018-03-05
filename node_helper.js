"use strict";

const NodeHelper = require("node_helper");
const SpotifyConnector = require("./core/SpotifyConnector");


module.exports = NodeHelper.create({

  start: function () {
    this.connector = undefined;
  },


  socketNotificationReceived: function (notification, payload) {
    switch (notification) {
      case "CONNECT_TO_SPOTIFY":
        this.connector = new SpotifyConnector(payload);
        this.connector.retrieveCurrentlyPlaying();
        break;
    }
  },
});
