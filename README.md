# MMM-NowPlayingOnSpotify

A module for [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) displaying the song currently playing on Spotify: title, artist, album, progress, the playing device and, optionally, the album cover.

![A song playing, with cover art](img/readme/NowPlayingOnSpotify.png)

The module talks to the Spotify Web API directly. You create your own Spotify app, authorize it once, and the module keeps itself authorized from then on. Spotify refresh tokens expire six months after authorization; the module warns you about two weeks ahead and shows a re-authorization banner on the mirror instead of silently going blank.

## Preconditions

- A MagicMirror² instance (Node.js 22 or newer)
- A Spotify Premium account – Spotify only lets Premium accounts create apps in development mode
- Up to five Spotify users per app – Spotify's limit for apps in development mode

The module has no runtime dependencies.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/raywo/MMM-NowPlayingOnSpotify.git
```

There is nothing to install with a package manager.

### Step 1 – Create a Spotify app

Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and note its **Client ID** and **Client Secret**.

Add this **Redirect URI** to the app:

```
https://raywo.github.io/MMM-NowPlayingOnSpotify/callback/
```

This is a static relay page. After you log in at Spotify, it sends your phone's browser straight back to the mirror in your local network. It only ever sees the one-time authorization code, which is worthless without your Client Secret; the tokens never leave the mirror. You can host your own copy of `docs/callback/` and register that URI instead.

### Step 2 – Configure the module

```javascript
{
  module: "MMM-NowPlayingOnSpotify",
  position: "top_right",
  config: {
    clientID: "<YOUR_CLIENT_ID>",
    clientSecret: "<YOUR_CLIENT_SECRET>",
    redirectURI: "https://raywo.github.io/MMM-NowPlayingOnSpotify/callback/"
  }
}
```

Tokens do not go into `config.js`. The module obtains them in step 3 and stores them in `tokens.json` inside the module folder. The file contains secrets – never share or commit it.

### Step 3 – Authorize

On a fresh installation there are no tokens yet, so the mirror shows a red authorization banner with a QR code right away. That is expected. The same steps renew the authorization every six months.

1. Scan the QR code with your phone.
2. Log in at Spotify and allow access.
3. Your phone returns to the mirror, the module stores the tokens and starts displaying – no restart needed.

**Your phone must be in the same network as the mirror.** The mirror does not need to be reachable from the internet and needs no port forwarding: the last step is a request from your phone to the mirror. It fails when the phone is on mobile data, in a guest network, or when the router isolates Wi-Fi clients from each other, as some mesh systems do.

While the banner is shown, the module listens on port 8888 in your local network and accepts nothing but the answer to the login it started.

If the QR code shows a wrong address – for example with several network interfaces – set `authHost` to the private IPv4 address your phone can reach, e.g. `192.168.1.20`. A hostname does not work: the relay page forwards to private IPv4 addresses only. If port 8888 is taken, set `authPort`. In a container, see [Running MagicMirror in Docker](#running-magicmirror-in-docker).

### Running MagicMirror in Docker

Inside a container the module only sees the container's own address, which your phone cannot reach. It therefore does not guess: without `authHost` the banner asks you to set it.

1. Set `authHost` to the LAN address of the computer that runs the container:
   ```javascript
   authHost: "192.168.1.20"
   ```
2. Publish the port on all interfaces, with the same number inside and outside. The phone connects to the host on the port the module listens on inside the container, so `"9999:8888"` or `"127.0.0.1:8888:8888"` does not work:
   ```yaml
   services:
     magicmirror:
       ports:
         - "8888:8888"
   ```
3. Give the host a fixed address in your router (DHCP reservation). `authHost` does not follow when the address changes.

On Linux, `network_mode: host` is an alternative: the container then uses the host's network and needs no port mapping. Set `authHost` all the same – the module cannot tell host networking from a regular container.

### Alternative: authorize without the relay page

If you do not want to use the relay page, register `http://127.0.0.1:8888/callback` as redirect URI and use it in `config.js`. Spotify accepts `http` redirect URIs only for the loopback address `127.0.0.1`, so the browser you log in with must reach port 8888 on the mirror itself:

1. On another computer, open an SSH tunnel to the mirror and keep it open:
   ```bash
   ssh -L 8888:127.0.0.1:8888 pi@<mirror-ip>
   ```
2. In a browser on that computer, open `http://127.0.0.1:8888` and log in at Spotify.
3. Spotify redirects back through the tunnel, the module stores the tokens and starts displaying.

Alternatively, open `http://127.0.0.1:8888` in a browser on the mirror's own desktop. `localhost`, a hostname or a LAN IP do not work as redirect URI: some are accepted in the dashboard and then rejected during login. The only part you may change is the port.

## Configuration options

| Option | Description |
|--------|-------------|
| `clientID` | **Required.** The Client ID of your Spotify app. |
| `clientSecret` | **Required.** The Client Secret of your Spotify app. |
| `redirectURI` | **Required.** The redirect URI registered in your Spotify app. An `https` URI uses the relay page and the QR code; `http://127.0.0.1:<port>/callback` uses the loopback flow on that port. Without it, the module cannot be (re-)authorized. |
| `authHost` | The mirror's private IPv4 address in your local network, shown in the QR code. Default: detected automatically. Only used with the relay page. |
| `authPort` | Port the module listens on in your local network during authorization. Default: `8888`. Only used with the relay page. |
| `showCoverArt` | Show the album cover. Default: `true` |
| `updatesEvery` | Interval in seconds for querying Spotify. Default: `1`. Higher values put less load on the Raspberry Pi and the network, but the display reacts later to song changes. |
| `idleAfter` | Seconds without playback – nothing playing or paused – after which the module queries Spotify less often. Default: `30`. |
| `idleUpdatesEvery` | Interval in seconds for querying Spotify while nothing is playing or playback is paused. Default: `10`. When playback starts, the display follows within this interval and then switches back to `updatesEvery`. Never shorter than `updatesEvery`; set it to the same value to query at a constant rate. |

## Customizing the appearance

Override the module's styles in MagicMirror's `css/custom.css` – changes there survive updates of the module. The most useful classes:

| Class | Element |
|-------|---------|
| `.NPOS_albumCover` | Album cover image |
| `.NPOS_infoText` | Each line of text (title, artist, album, time, device, in this order) |
| `.NPOS_progress` | Progress bar |
| `.NPOS_nothingIsPlayingImage` | Spotify logo shown when nothing is playing |

For example, to shrink the cover and hide the logo when nothing is playing:

```css
.MMM-NowPlayingOnSpotify .NPOS_albumCover {
  width: 50%;
}

.MMM-NowPlayingOnSpotify .NPOS_nothingIsPlayingImage {
  display: none;
}
```

## Update

```bash
cd ~/MagicMirror/modules/MMM-NowPlayingOnSpotify
git pull
```

### If `git pull` reports "no such ref was fetched"

The default branch was renamed from `master` to `main`. Clones made before the rename still track `master` and need a one-time switch:

```bash
cd ~/MagicMirror/modules/MMM-NowPlayingOnSpotify
git branch -m master main
git fetch origin
git branch -u origin/main main
git remote set-head origin -a
```

After that, `git pull` works as before.

### Upgrading from version 1

Version 1 kept `accessToken` and `refreshToken` in `config.js`. Version 2 moves them into `tokens.json` on the first start. After that:

1. Remove `accessToken` and `refreshToken` from `config.js`.
2. Add `redirectURI` to `config.js` and register the same URI in your Spotify app (see step 1). Without it, the module cannot renew the authorization when the refresh token expires.

If you already use `http://127.0.0.1:8888/callback`, nothing changes for you. To switch to the QR code, register the relay URI from step 1 in your Spotify app and set it as `redirectURI`.

The two-week warning is not available for tokens taken over from version 1, because their age is unknown. You see the banner only when they expire; after that re-authorization the warning works as usual.

## Localization

The authorization texts follow MagicMirror's `language` setting. English and German are included in `translations/`; add another language by adding a JSON file there.

## Development

The project uses [pnpm](https://pnpm.io) for its development tooling:

```bash
pnpm install
pnpm lint
```

## Credits

Version 2 – token expiry handling, token store, integrated authorization server and the dependency-free rewrite – was contributed by [Dr. Ralf Korell](https://github.com/rkorell).

## License

MIT, see [LICENSE](LICENSE).

The QR code is drawn with [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase, included in `vendor/` under the MIT license.
