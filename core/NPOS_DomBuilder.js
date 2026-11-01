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
// Change while the same track plays; they only reach the info area.
// hideWhileIdle is not shown at all.
const NPOS_PLAYBACK_FIELDS = ['progress', 'isPlaying', 'hideWhileIdle'];
// Scrolling of lines wider than the module. Both can be overridden in
// custom.css through the custom properties named here.
const NPOS_SCROLL_SPEED_PROPERTY = '--NPOS-scroll-speed';
const NPOS_SCROLL_PAUSE_PROPERTY = '--NPOS-scroll-pause';
const NPOS_DEFAULT_SCROLL_SPEED = 40;     // pixels per second
const NPOS_DEFAULT_SCROLL_PAUSE = 2;      // seconds at either end
const NPOS_SCROLLABLE_CLASS = 'NPOS_infoText--scrollable';
const NPOS_SCROLLING_CLASS = 'NPOS_infoText--scrolling';

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

    infoArea.appendChild(this.getInfoDiv('fa fa-music', context.songTitle, true));
    infoArea.appendChild(this.getInfoDiv('fa fa-microphone', context.artist, true));
    infoArea.appendChild(this.getInfoDiv('fa fa-compact-disc', context.album, true));
    let timeInfo = this.getInfoDiv(this.getPlayStatusIcon(context.isPlaying), this.getTimeInfo(context), false);
    timeInfo.classList.add('NPOS_infoText--time');
    infoArea.appendChild(timeInfo);
    infoArea.appendChild(this.getProgressBar(context));
    infoArea.appendChild(this.getInfoDiv(context.deviceName ? 'fa fa-headphones' : '', context.deviceName, true));

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

  /**
   * A line of text with an optional icon in front. The text sits in a clip
   * of its own, so a scrollable line moves only the text, not the icon.
   */
  getInfoDiv(symbol, text, scrollable) {
    let infoDiv = document.createElement('div');
    infoDiv.className = 'NPOS_infoText';
    if (scrollable && this.config.scrollLongText) {
      infoDiv.classList.add(NPOS_SCROLLABLE_CLASS);
    }

    if (symbol) {
      let icon = document.createElement('i');
      icon.className = 'NPOS_icon ' + symbol;
      infoDiv.appendChild(icon);
    }

    let clip = document.createElement('div');
    clip.className = 'NPOS_infoTextClip';
    let inner = document.createElement('span');
    inner.className = 'NPOS_infoTextInner';
    inner.textContent = text;
    clip.appendChild(inner);
    infoDiv.appendChild(clip);

    return infoDiv;
  }

  /**
   * Lets every scrollable line that is wider than the module scroll to its
   * end and back. Needs the rendered layout, so call it once the info area
   * is in the document, and again whenever its width changes.
   *
   * All lines share one cycle, set by the longest line: they leave the start
   * together and the end together, so no two lines ever move in opposite
   * directions. A shorter line arrives earlier and waits. While no distance
   * changes, the running animations go on; otherwise all start over
   * together, so they stay in step.
   */
  scrollLongLines(infoArea) {
    let lines = Array.from(infoArea.querySelectorAll('.' + NPOS_SCROLLABLE_CLASS))
      .map((line) => this.measureLine(line));
    let distances = lines.map((entry) => entry.distance).join(',');
    let overflowing = lines.filter((entry) => entry.distance > 0);
    let running = overflowing.every((entry) => entry.inner.getAnimations().length > 0);

    if (running && infoArea.dataset.scrollDistances === distances) {
      return;
    }
    infoArea.dataset.scrollDistances = distances;

    lines.forEach((entry) => {
      entry.inner.getAnimations().forEach((animation) => animation.cancel());
      entry.line.classList.toggle(NPOS_SCROLLING_CLASS, entry.distance > 0);
    });
    if (overflowing.length === 0) {
      return;
    }

    let longest = Math.max(...overflowing.map((entry) => entry.distance));
    let timing = this.getScrollTiming(infoArea, longest);
    let startTime = document.timeline.currentTime;

    overflowing.forEach((entry) => {
      let animation = entry.inner.animate(this.getScrollKeyframes(entry.distance, timing), {
        duration: timing.total,
        iterations: Infinity
      });
      animation.startTime = startTime;
    });
  }

  measureLine(line) {
    let clip = line.querySelector('.NPOS_infoTextClip');
    let inner = clip.firstChild;
    // Not clip.scrollWidth: it counts the shifted text in and comes out
    // short while the line is scrolled away from its start.
    let distance = inner.offsetWidth - clip.clientWidth;

    return { line, inner, distance: Math.max(distance, 0) };
  }

  /**
   * One cycle for all lines, long enough for the longest one. speed is in
   * pixels per millisecond, all times in milliseconds.
   */
  getScrollTiming(infoArea, longest) {
    let style = getComputedStyle(infoArea);
    let speed = this.readPositiveNumber(style, NPOS_SCROLL_SPEED_PROPERTY, NPOS_DEFAULT_SCROLL_SPEED) / NPOS_MS_PER_SECOND;
    let pause = this.readPositiveNumber(style, NPOS_SCROLL_PAUSE_PROPERTY, NPOS_DEFAULT_SCROLL_PAUSE) * NPOS_MS_PER_SECOND;
    let longestMove = longest / speed;

    return { speed, pause, longestMove, total: 2 * pause + 2 * longestMove };
  }

  readPositiveNumber(style, property, fallback) {
    let value = parseFloat(style.getPropertyValue(property));
    return value > 0 ? value : fallback;
  }

  /**
   * Pause at the start, scroll to the end at the common speed, wait there
   * until the longest line has paused at its end as well, scroll back, and
   * wait at the start for the next cycle.
   */
  getScrollKeyframes(distance, timing) {
    let start = 'translateX(0)';
    let end = 'translateX(' + (-distance) + 'px)';
    let move = distance / timing.speed;
    let leaveStart = timing.pause;
    let leaveEnd = 2 * timing.pause + timing.longestMove;
    let at = (time) => time / timing.total;

    return [
      { transform: start, offset: 0 },
      { transform: start, offset: at(leaveStart), easing: 'ease-in-out' },
      { transform: end, offset: at(leaveStart + move) },
      { transform: end, offset: at(leaveEnd), easing: 'ease-in-out' },
      { transform: start, offset: at(leaveEnd + move) },
      { transform: start, offset: 1 }
    ];
  }

  /**
   * Identifies what the module shows, apart from the fields that change
   * during playback of the same track. Two contexts with the same key differ
   * only in what updateInfoArea() can update in place.
   */
  getLayoutKey(context) {
    let layout = Object.assign({}, context);
    NPOS_PLAYBACK_FIELDS.forEach((field) => delete layout[field]);

    return JSON.stringify(layout);
  }

  /**
   * Updates time, play state and progress bar of a rendered wrapper in
   * place. The cover and its blurred glow are not rasterized again, and the
   * scrolling lines keep running instead of starting over.
   *
   * @returns {boolean} false if the wrapper has no info area to update.
   */
  updateInfoArea(wrapper, context) {
    let timeInfo = wrapper.querySelector('.NPOS_infoText--time');
    let progressBar = wrapper.querySelector('.NPOS_progress');
    if (!timeInfo || !progressBar) {
      return false;
    }

    timeInfo.querySelector('.NPOS_icon').className = 'NPOS_icon ' + this.getPlayStatusIcon(context.isPlaying);
    timeInfo.querySelector('.NPOS_infoTextInner').textContent = this.getTimeInfo(context);
    progressBar.value = context.progress;

    return true;
  }

  getCoverArtDiv(coverURL) {
    let coverArea = document.createElement('div');
    coverArea.className = 'NPOS_coverArtArea';

    if (this.config.coverGlow) {
      coverArea.classList.add('NPOS_coverArtArea--glow');
      coverArea.appendChild(this.getCoverGlow(coverURL));
    }

    let cover = document.createElement('img');
    cover.src = coverURL;
    cover.className = 'NPOS_albumCover';
    // Shadow and glow exclude each other: the shadow sets the cover apart
    // from the background, the glow blends it in. The glow is opt-in while
    // the shadow is on by default, so the glow wins.
    if (this.config.coverShadow && !this.config.coverGlow) {
      cover.classList.add('NPOS_albumCover--shadow');
    }

    coverArea.appendChild(cover);

    return coverArea;
  }

  // A blurred copy of the cover behind it; decorative, so hidden from
  // assistive technology.
  getCoverGlow(coverURL) {
    let glow = document.createElement('img');
    glow.src = coverURL;
    glow.alt = '';
    glow.className = 'NPOS_coverGlow';
    glow.setAttribute('aria-hidden', 'true');

    return glow;
  }

  getPlayStatusIcon(isPlaying) {
    return isPlaying ? 'fa fa-play' : 'fa fa-pause';
  }
}
