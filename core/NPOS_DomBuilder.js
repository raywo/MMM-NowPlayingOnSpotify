/* MMM-NowPlayingOnSpotify - NPOS_DomBuilder
 *
 * Builds the module DOM. Runs in the browser (frontend). No external
 * dependencies: durations are formatted locally instead of via moment. The QR
 * code comes from the vendored qrcode-generator (global `qrcode`).
 */

const NPOS_SECONDS_PER_MINUTE = 60;
const NPOS_MINUTES_PER_HOUR = 60;
const NPOS_MS_PER_SECOND = 1000;
const NPOS_SVG_NS = 'http://www.w3.org/2000/svg';
// Type 0 picks the smallest QR version that fits; M survives minor glare.
const NPOS_QR_TYPE_AUTO = 0;
const NPOS_QR_ERROR_CORRECTION = 'M';
// Scanners need a light margin of four modules around the code.
const NPOS_QR_QUIET_ZONE = 4;

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

    return this.getWrapper(content, context.reauthWarning, context);
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

  getWrapper(content, showWarning, authInfo) {
    let wrapper = document.createElement('div');
    wrapper.className = 'small';

    if (showWarning) {
      wrapper.appendChild(this.getWarningBanner(authInfo));
    }
    if (authInfo && authInfo.unavailable) {
      wrapper.appendChild(this.getStatusBanner(authInfo.unavailable));
    }
    wrapper.appendChild(content);

    return wrapper;
  }

  /**
   * Tells that the shown data is stale. Only waiting helps, so the banner is
   * deliberately calmer than the red re-authorization banners.
   */
  getStatusBanner(unavailable) {
    let banner = document.createElement('div');
    banner.className = 'NPOS_statusBanner';
    banner.appendChild(document.createTextNode(this.getStatusText(unavailable)));

    return banner;
  }

  getStatusText(unavailable) {
    if (unavailable.reason === 'RATE_LIMITED') {
      return this.translate('STATUS_RATE_LIMITED', { time: this.formatClockTime(unavailable.retryAt) });
    }
    return this.translate('STATUS_UNREACHABLE');
  }

  formatClockTime(timestamp) {
    let language = typeof config !== 'undefined' ? config.language : undefined;
    return new Date(timestamp).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  }

  getWarningBanner(authInfo) {
    let banner = document.createElement('div');
    banner.className = 'NPOS_reauthBanner NPOS_reauthBanner--warning';

    let title = document.createElement('div');
    title.className = 'NPOS_reauthTitle';
    title.innerHTML = this.translate('REAUTH_WARNING');
    banner.appendChild(title);

    if (authInfo.authURL) {
      banner.appendChild(this.getURLBlock(authInfo.authURL, authInfo.authRelay));
    } else if (authInfo.authUnavailableReason) {
      banner.appendChild(this.getUnavailableText(authInfo.authUnavailableReason));
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
      content.appendChild(this.getURLBlock(authInfo.authURL, authInfo.authRelay));
    } else {
      content.appendChild(this.getUnavailableText((authInfo && authInfo.authUnavailableReason) || 'REAUTH_NO_REDIRECT'));
    }

    return content;
  }

  getUnavailableText(reasonKey) {
    let text = document.createElement('div');
    text.className = 'NPOS_reauthText';
    text.innerHTML = this.translate(reasonKey);

    return text;
  }

  getURLBlock(authURL, authRelay) {
    let block = document.createElement('div');

    let label = document.createElement('div');
    label.className = 'NPOS_reauthText';
    label.innerHTML = this.translate(authRelay ? 'REAUTH_SCAN_QR' : 'REAUTH_OPEN_URL');
    block.appendChild(label);

    if (authRelay) {
      block.appendChild(this.getQRCode(authURL));
    }

    let url = document.createElement('div');
    url.className = 'NPOS_reauthURL';
    url.textContent = authURL;
    block.appendChild(url);

    if (authRelay) {
      let hint = document.createElement('div');
      hint.className = 'NPOS_reauthHint xsmall';
      hint.innerHTML = this.translate('REAUTH_SAME_NETWORK');
      block.appendChild(hint);
    }

    return block;
  }

  getQRCode(text) {
    let qr = qrcode(NPOS_QR_TYPE_AUTO, NPOS_QR_ERROR_CORRECTION);
    qr.addData(text);
    qr.make();

    let modules = qr.getModuleCount();
    let size = modules + 2 * NPOS_QR_QUIET_ZONE;

    let svg = document.createElementNS(NPOS_SVG_NS, 'svg');
    svg.setAttribute('class', 'NPOS_reauthQR');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('shape-rendering', 'crispEdges');

    let background = document.createElementNS(NPOS_SVG_NS, 'rect');
    background.setAttribute('width', size);
    background.setAttribute('height', size);
    background.setAttribute('fill', '#fff');
    svg.appendChild(background);

    let path = '';
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (qr.isDark(row, col)) {
          path += 'M' + (col + NPOS_QR_QUIET_ZONE) + ' ' + (row + NPOS_QR_QUIET_ZONE) + 'h1v1h-1z';
        }
      }
    }

    let dark = document.createElementNS(NPOS_SVG_NS, 'path');
    dark.setAttribute('d', path);
    dark.setAttribute('fill', '#000');
    svg.appendChild(dark);

    return svg;
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
    content.className = 'NPOS_playingContent';

    if (this.config.showCoverArt) {
      content.appendChild(this.getCoverArtDiv(context.imgURL));
    } else {
      content.appendChild(this.getIconImage('NPOS_logoImage'));
    }

    content.appendChild(this.getInfoArea(context));

    return content;
  }

  getInfoArea(context) {
    let infoArea = document.createElement('div');
    infoArea.className = 'NPOS_infoArea';

    infoArea.appendChild(this.getInfoDiv('fa fa-music', context.songTitle));
    infoArea.appendChild(this.getInfoDiv('fa fa-user', context.artist));
    infoArea.appendChild(this.getInfoDiv('fa fa-folder', context.album));
    infoArea.appendChild(this.getInfoDiv(this.getPlayStatusIcon(context.isPlaying), this.getTimeInfo(context)));
    infoArea.appendChild(this.getProgressBar(context));
    infoArea.appendChild(this.getInfoDiv('', context.deviceName));

    return infoArea;
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
