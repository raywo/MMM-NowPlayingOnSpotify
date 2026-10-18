/* MMM-NowPlayingOnSpotify - NPOS_DomBuilder
 *
 * Builds the module DOM. Runs in the browser (frontend). No external
 * dependencies: durations are formatted locally instead of via moment.
 */

const NPOS_SECONDS_PER_MINUTE = 60;
const NPOS_MINUTES_PER_HOUR = 60;
const NPOS_MS_PER_SECOND = 1000;

class NPOS_DomBuilder {

  constructor(config, pathPrefix, translate) {
    this.config = config;
    this.pathPrefix = pathPrefix + '/';
    this.translate = translate || ((key) => key);
  }

  getDom(context) {
    let content = context.noSong
      ? this.getNothingIsPlayingContent()
      : this.getPlayingContent(context);

    return this.getWrapper(content, context.reauthWarning, context.authURL);
  }

  getInitDom(loadingText) {
    return this.getWrapper(this.getInitializingContent(loadingText), false, null);
  }

  getReauthDom(authInfo) {
    let wrapper = document.createElement('div');
    wrapper.className = 'small';
    wrapper.appendChild(this.getReauthContent(authInfo));

    return wrapper;
  }

  getWrapper(content, showWarning, authURL) {
    let wrapper = document.createElement('div');
    wrapper.className = 'small';

    if (showWarning) {
      wrapper.appendChild(this.getWarningBanner(authURL));
    }
    wrapper.appendChild(content);

    return wrapper;
  }

  getWarningBanner(authURL) {
    let banner = document.createElement('div');
    banner.className = 'NPOS_reauthBanner NPOS_reauthBanner--warning';

    let title = document.createElement('div');
    title.className = 'NPOS_reauthTitle';
    title.innerHTML = this.translate('REAUTH_WARNING');
    banner.appendChild(title);

    if (authURL) {
      banner.appendChild(this.getURLBlock(authURL));
    }

    return banner;
  }

  getReauthContent(authInfo) {
    let content = document.createElement('div');
    content.className = 'NPOS_reauthBanner NPOS_reauthBanner--full';

    let title = document.createElement('div');
    title.className = 'NPOS_reauthTitle';
    title.innerHTML = this.translate('REAUTH_REQUIRED_TITLE');
    content.appendChild(title);

    if (authInfo && authInfo.authURL) {
      content.appendChild(this.getURLBlock(authInfo.authURL));
    } else {
      let text = document.createElement('div');
      text.className = 'NPOS_reauthText';
      text.innerHTML = this.translate('REAUTH_NO_REDIRECT');
      content.appendChild(text);
    }

    return content;
  }

  getURLBlock(authURL) {
    let block = document.createElement('div');

    let label = document.createElement('div');
    label.className = 'NPOS_reauthText';
    label.innerHTML = this.translate('REAUTH_OPEN_URL');

    let url = document.createElement('div');
    url.className = 'NPOS_reauthURL';
    url.innerHTML = authURL;

    block.appendChild(label);
    block.appendChild(url);

    return block;
  }

  getInitializingContent(loadingText) {
    let content = document.createElement('div');
    content.className = 'NPOS_initContent';

    let loadingDiv = document.createElement('div');
    loadingDiv.className = 'NPOS_loading medium';
    loadingDiv.innerHTML = loadingText;

    content.appendChild(loadingDiv);

    return content;
  }

  getNothingIsPlayingContent() {
    let content = document.createElement('div');
    content.className = 'NPOS_nothingIsPlayingContent';
    content.appendChild(this.getLogoImage());

    return content;
  }

  getLogoImage() {
    return this.getImage('img/Spotify_Logo_RGB_White.png', 'NPOS_nothingIsPlayingImage');
  }

  getIconImage(className) {
    return this.getImage('img/Spotify_Icon_RGB_White.png', className);
  }

  getImage(imageName, className) {
    let image = document.createElement('img');
    image.src = this.pathPrefix + imageName;
    image.className = className;

    return image;
  }

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
  getPlayingContent(context) {
    let content = document.createElement('div');

    if (this.config.showCoverArt) {
      content.appendChild(this.getCoverArtDiv(context.imgURL));
    } else {
      content.appendChild(this.getIconImage('NPOS_logoImage'));
    }

    content.appendChild(this.getInfoDiv('fa fa-music', context.songTitle));
    content.appendChild(this.getInfoDiv('fa fa-user', context.artist));
    content.appendChild(this.getInfoDiv('fa fa-folder', context.album));
    content.appendChild(this.getInfoDiv(this.getPlayStatusIcon(context.isPlaying), this.getTimeInfo(context)));
    content.appendChild(this.getProgressBar(context));
    content.appendChild(this.getInfoDiv('', context.deviceName));

    return content;
  }

  getProgressBar(context) {
    let progressBar = document.createElement('progress');
    progressBar.className = 'NPOS_progress';
    progressBar.value = context.progress;
    progressBar.max = context.titleLength;

    return progressBar;
  }

  getTimeInfo(context) {
    return this.formatDuration(context.progress) + ' / ' + this.formatDuration(context.titleLength);
  }

  formatDuration(milliseconds) {
    let totalSeconds = Math.floor((milliseconds || 0) / NPOS_MS_PER_SECOND);
    let seconds = totalSeconds % NPOS_SECONDS_PER_MINUTE;
    let totalMinutes = Math.floor(totalSeconds / NPOS_SECONDS_PER_MINUTE);
    let minutes = totalMinutes % NPOS_MINUTES_PER_HOUR;
    let hours = Math.floor(totalMinutes / NPOS_MINUTES_PER_HOUR);

    if (hours > 0) {
      return hours + ':' + this.pad(minutes) + ':' + this.pad(seconds);
    }
    return minutes + ':' + this.pad(seconds);
  }

  pad(value) {
    return value < 10 ? '0' + value : '' + value;
  }

  getInfoDiv(symbol, text) {
    let infoDiv = document.createElement('div');
    infoDiv.className = 'NPOS_infoText';

    if (symbol) {
      let icon = document.createElement('i');
      icon.className = 'NPOS_icon ' + symbol;
      infoDiv.appendChild(icon);
    }

    infoDiv.appendChild(document.createTextNode(text));

    return infoDiv;
  }

  getCoverArtDiv(coverURL) {
    let coverArea = document.createElement('div');
    coverArea.className = 'NPOS_coverArtArea';

    let cover = document.createElement('img');
    cover.src = coverURL;
    cover.className = 'NPOS_albumCover';

    coverArea.appendChild(cover);

    return coverArea;
  }

  getPlayStatusIcon(isPlaying) {
    return isPlaying ? 'fa fa-play' : 'fa fa-pause';
  }
}
