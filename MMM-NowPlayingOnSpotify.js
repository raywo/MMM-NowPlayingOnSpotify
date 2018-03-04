'use strict';

Module.register('MMM-NowPlayingOnSpotify', {

  // default values
  defaults: {
    // Module misc
    name: 'MMM-NowPlayingOnSpotify',
    hidden: false,
    updatesEvery: 5,          // How often should the table be updated in s?
    showCoverArt: true       // Do you want the cover art to be displayed?
  },


  start: function () {
    Log.info("Starting module: " + this.name );

  },

  getDom: function () {
    let wrapper = document.createElement("div");
    wrapper.className = "small";

    let content = this.getImage("NPOS_dimmed");

    let context = {
      imgURL: "https://i.scdn.co/image/8c1e066b5d1045038437d92815d49987f519e44f",
      songTitle: "Mr. Brightside",
      artist: "The Killers The Killers The Killers The Killers ",
      album: "Hot Fuss",
      titleLength: 222075,
      progress: 44272,
      isPlaying: true,
      deviceName: "Rays iMac"
    };

    wrapper.appendChild(this.getPlayingContent(context));

    return wrapper;
  },

  getStyles: function () {
    return [
      this.file("css/styles.css"),
      this.file("node_modules/moment-duration-format/lib/moment-duration-format.js"),
      "font-awesome.css"
    ];
  },

  getImage: function (className) {
    let image = document.createElement("img");
    image.src = this.file("img/Spotify_Icon_RGB_White.png");
    image.className += className;

    return image;
  },

  /**
   * Returns a div configured for the given context.
   *
   * context = {
   *   imgURL: *an url*,
   *   songTitle: *string*,
   *   artist: *string*,
   *   album: *string*,
   *   titleLength: *num*,
   *   progress: *num*,
   *   isPlaying: *boolean*,
   *   deviceName: *string*
   * }
   *
   * @param context
   * @returns {HTMLDivElement}
   */
  getPlayingContent: function (context) {
    let content = document.createElement("div");

    let currentPos = moment.duration(context.progress);
    let length = moment.duration(context.titleLength);

    let titleDiv = this.getInfoDiv("fa fa-music", context.songTitle);
    let artistDiv = this.getInfoDiv("fa fa-user", context.artist);
    let albumDiv = this.getInfoDiv("fa fa-folder", context.album);
    let progressDiv = this.getInfoDiv("fa fa-clock-o", currentPos.format() + " / " + length.format());

    let progressBar = document.createElement("progress");
    progressBar.className = "NPOS_progress";
    progressBar.value = context.progress;
    progressBar.max = context.titleLength;

    if (this.config.showCoverArt) {
      let coverArea = this.getCoverArtDiv(context.imgURL);
      content.appendChild(coverArea);
    } else {
      let logoImg = this.getImage("NPOS_logoImage");
      content.appendChild(logoImg);
    }

    content.appendChild(titleDiv);
    content.appendChild(artistDiv);
    content.appendChild(albumDiv);
    content.appendChild(progressDiv);
    content.appendChild(progressBar);

    let wherePlayingDiv = document.createElement("div");
    wherePlayingDiv.innerHTML = context.deviceName;

    content.appendChild(wherePlayingDiv);

    return content;
  },

  getInfoDiv: function (symbol, text) {
    let infoDiv = document.createElement("div");
    infoDiv.className = "NPOS_infoText";
    let icon = document.createElement("i");
    icon.className = "NPOS_icon " + symbol;
    let testNode = document.createTextNode(text);

    infoDiv.appendChild(icon);
    infoDiv.appendChild(testNode);

    return infoDiv;
  },

  getCoverArtDiv: function (coverURL) {
    let coverArea = document.createElement("div");
    coverArea.className = "NPOS_coverArea";

    let cover = document.createElement("img");
    cover.src = coverURL;
    cover.className = "NPOS_albumCover";

    coverArea.appendChild(cover);

    return coverArea;
  },
});
