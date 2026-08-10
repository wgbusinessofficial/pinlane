# Pin Deck — install on your iPhone

Four files. No App Store, no Apple ID, no certificates, nothing to re-sign.

## 1. Put it online

Any static host works. Free options:

**GitHub Pages**
1. Make a new public repo, e.g. `pin-deck`
2. Upload `index.html`, `sw.js`, `manifest.webmanifest`, and the `icons` folder
   (keep the folder structure — icons must stay in `icons/`)
3. Repo → Settings → Pages → Source: `main`, folder: `/ (root)` → Save
4. Wait a minute, then open `https://<your-username>.github.io/pin-deck/`

**Netlify Drop** — go to app.netlify.com/drop and drag this whole folder in.
No account needed to start. Gives you a URL immediately.

HTTPS is required for offline mode to work. All three options above provide it.

## 2. Add it to your home screen

On the iPhone, open the URL **in Safari** (not Chrome — only Safari can install
web apps on iOS):

1. Tap the Share button
2. Scroll down → **Add to Home Screen**
3. Name it and tap Add

You get a bowling pin icon. It opens full screen with no browser bar, and works
without signal once it has loaded a first time — which matters, because alley
wifi is usually terrible.

## 3. Where your data lives

Everything is stored in your phone's local storage. It never leaves the device
and there's no account or server. That also means:

- Clearing Safari website data erases your games
- It does not sync to other devices
- Reinstalling from the same URL keeps the data

The Reset button at the bottom of the History tab wipes it deliberately.

## Updating it later

Replace `index.html` and bump the cache version in `sw.js` — change
`pin-deck-v1` to `pin-deck-v2`. Without that bump the old cached copy keeps
loading and you won't see your changes.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The whole app — React and all code inlined, ~190 KB |
| `sw.js` | Service worker, caches the app for offline use |
| `manifest.webmanifest` | Name, colors, icons for the installed app |
| `icons/` | App icons (180 / 192 / 512 px) |
