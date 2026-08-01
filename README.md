# Gacha Stamina Calculator

Track stamina replenishment across multiple gacha games at once.

A single-file, dependency-free, installable web app. Add a card per game, enter
your current stamina, and it tells you how long until it refills — with a live
countdown that keeps ticking, and stamina that keeps regenerating while the app
is closed.

**Live:** https://regigicas.github.io/gacha-energy/

## Features

- One card per game, with quick-add presets for Genshin Impact, Honkai: Star Rail and Zenless Zone Zero
- Live countdown and a stamina bar that fills in real time
- Stamina regenerates while the app is closed — reopen it and the numbers are already current
- Everything is saved locally in `localStorage`; nothing leaves your device
- Installable PWA with full offline support (Apple, Android and Windows)

## Running locally

Any static file server works. A service worker needs a real origin, so open it
over HTTP rather than as a `file://` URL:

```bash
python -m http.server 8123
```

Then visit <http://localhost:8123>.

## Project layout

| Path                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `index.html`            | The entire app — markup, styles and logic            |
| `sw.js`                 | Service worker: precaches the app shell for offline  |
| `manifest.webmanifest`  | PWA metadata and icons                               |
| `icons/`                | App icons, including maskable variants               |

## Notes for contributors

- **Bump `CACHE_VERSION` in `sw.js`** whenever a precached asset changes, or
  clients will keep serving the old shell.
- **Never build card markup by string interpolation.** Stored state is
  untrusted — on GitHub Pages every repo under the same user shares one origin,
  and therefore one `localStorage`. The card is cloned from a `<template>` and
  values are assigned through `.value` / `.textContent`; keep it that way.
- The CSP in `index.html` still needs `'unsafe-inline'` because the script and
  styles are inline. Moving them into `app.js` / `styles.css` would allow
  tightening it to `script-src 'self'` — at the cost of the single-file layout.
- There are no build steps, no dependencies and no third-party requests. Please
  keep it that way; the font stack is deliberately the system one so the app
  loads instantly, works offline and leaks nothing to a font CDN.

## License

MIT — see [LICENSE](LICENSE).
