# Gacha Stamina Calculator

Track stamina replenishment across multiple gacha games at once.

A dependency-free, installable web app. Add a card per game, enter your current
stamina, and it tells you how long until it refills — with a live countdown that
keeps ticking, and stamina that keeps regenerating while the app is closed.

**Live:** https://regigicas.github.io/gacha-energy/

## Features

- One card per game, with quick-add presets for Genshin Impact, Honkai: Star Rail,
  Zenless Zone Zero, Wuthering Waves and Arknights
- Live countdown and a stamina bar that fills in real time
- Stamina regenerates while the app is closed — reopen it and the numbers are already current
- Optional target per game ("when will I have 40?")
- Stamina over the cap (refill items) is shown as such, not rejected
- Reorder cards, undo a removal, export and import your games as JSON
- Optional notification when a game fills up while the app is in the background
- Everything is saved locally in `localStorage`; nothing leaves your device
- Installable PWA with full offline support (Apple, Android and Windows)

## Running locally

Any static file server works. ES modules and the service worker need a real
origin, so open it over HTTP rather than as a `file://` URL:

```bash
python -m http.server 8123
```

Then visit <http://localhost:8123>.

## Tests

The stamina maths lives in `stamina.js`, which has no DOM access, so it runs
under Node's built-in test runner — no install step:

```bash
node --test
```

## Project layout

| Path                    | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `index.html`            | Markup, including the card `<template>`                   |
| `styles.css`            | All styles                                                |
| `app.js`                | DOM, persistence, countdown, notifications                |
| `stamina.js`            | Pure logic: the game model, regen maths, formatting       |
| `tests/`                | Unit tests for `stamina.js` (`node --test`)               |
| `sw.js`                 | Service worker: network-first, cache fallback for offline |
| `manifest.webmanifest`  | PWA metadata and icons                                    |
| `icons/`                | App icons, including maskable variants                    |

## Notes for contributors

- **How stamina is stored.** Each game keeps `cur` (the stamina at `anchorAt`)
  plus its settings; current stamina is always derived from those. The anchor
  only moves when the player edits a field, and editing max or regen first
  banks the stamina earned so far (`reanchor`). Never save a snapshot of the
  live value — that is how progress used to get lost.
- **Never build card markup by string interpolation.** Stored state and imported
  files are untrusted — on GitHub Pages every repo under the same user shares one
  origin, and therefore one `localStorage`. The card is cloned from a
  `<template>` and values are assigned through `.value` / `.textContent`; keep it
  that way. Everything read back goes through `parseState` / `normalizeGame`.
- The CSP allows no inline script or style. Keep it that way: no `style="…"`
  attributes, no inline handlers.
- The service worker is network-first, so deploys reach users on their next
  load. Bump `CACHE_VERSION` in `sw.js` only when the `SHELL` list or the
  caching strategy changes, and add any new file the app needs to `SHELL`.
- There are no build steps, no dependencies and no third-party requests. Please
  keep it that way; the font stack is deliberately the system one so the app
  loads instantly, works offline and leaks nothing to a font CDN.

## License

MIT — see [LICENSE](LICENSE).
