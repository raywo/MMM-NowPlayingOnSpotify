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
http://127.0.0.1:8888/callback
```

Spotify accepts `http` redirect URIs only for the loopback address `127.0.0.1`. `localhost`, a hostname or a LAN IP do not work: some are accepted in the dashboard and then rejected during login. The only part you may change is the port – then change it in `config.js` as well.

### Step 2 – Configure the module

```javascript
{
  module: "MMM-NowPlayingOnSpotify",
  position: "top_right",
  config: {
    clientID: "<YOUR_CLIENT_ID>",
    clientSecret: "<YOUR_CLIENT_SECRET>",
    redirectURI: "http://127.0.0.1:8888/callback"
  }
}
```

Tokens do not go into `config.js`. The module obtains them in step 3 and stores them in `tokens.json` inside the module folder. The file contains secrets – never share or commit it.

### Step 3 – Authorize

On a fresh installation there are no tokens yet, so the mirror shows a red authorization banner right away. That is expected. The same steps renew the authorization every six months.

The redirect URI is a loopback address, so the browser you log in with must reach port 8888 on the mirror itself:

1. On another computer, open an SSH tunnel to the mirror and keep it open:
   ```bash
   ssh -L 8888:127.0.0.1:8888 pi@<mirror-ip>
   ```
2. In a browser on that computer, open `http://127.0.0.1:8888` and click **Log in with Spotify**.
3. Spotify redirects back through the tunnel, the module stores the tokens and starts displaying – no restart needed.

Alternatively, open `http://127.0.0.1:8888` in a browser on the mirror's own desktop.

## Configuration options

| Option | Description |
|--------|-------------|
| `clientID` | **Required.** The Client ID of your Spotify app. |
| `clientSecret` | **Required.** The Client Secret of your Spotify app. |
| `redirectURI` | **Required.** The redirect URI registered in your Spotify app. The module's authorization server listens on its port. Without it, the module cannot be (re-)authorized. |
| `showCoverArt` | Show the album cover. Default: `true` |
| `updatesEvery` | Interval in seconds for querying Spotify. Default: `1`. Higher values put less load on the Raspberry Pi and the network, but the display reacts later to song changes. |

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

### Upgrading from version 1

Version 1 kept `accessToken` and `refreshToken` in `config.js`. Version 2 moves them into `tokens.json` on the first start. After that:

1. Remove `accessToken` and `refreshToken` from `config.js`.
2. Add `redirectURI` to `config.js` and register the same URI in your Spotify app (see step 1). Without it, the module cannot renew the authorization when the refresh token expires.

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
