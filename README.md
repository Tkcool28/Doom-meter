# Doomroom News 🛰️☄️  
**Doom Index (Highly Scientific)** — a tiny PWA that fetches headlines (via a Cloudflare Worker proxy), scores the vibes, and displays a doom meter + category breakdown.

## What this project is
A mobile-first “global briefing” page that:
- Pulls headlines (English / United States filter)
- Shows a **Doom Index** number + label (e.g., “Chill (suspiciously).”)
- Shows a **doom breakdown** by category (Conflict Heat, Climate Weirdness, etc.)
- Lists **Top Drivers** (what’s pushing doom)
- Lists **Latest Stories** with **clickable links**
- Works nicely as a **home-screen app** (PWA)

---

## Current Status (Saved State)
✅ Headlines load and links open correctly on mobile  
✅ Doom meter UI is working (main index + breakdown bars)  
✅ English filtering is working (English / United States)  
✅ “About” button works (modal with version + calm message + joke company)  
✅ App can be installed on Android home screen (PWA)  
⚠️ Sometimes CSS tweaks can “bork” the bars (avoid late-night random CSS surgery)

---

## Repo Structure
Expected files in the repo root:
---

## Icons / Branding
App icon = 8-bit pixel art of a comet exploding Earth ☄️🌍 (retro video game style)

Icon files used:
- `icons/apple-touch-icon.png` (iOS home screen)
- `icons/favicon-32.png`
- `icons/favicon-16.png`
- `icons/doomroom-192.png`
- `icons/doomroom-512.png` (PWA install icons)

---

## PWA Install (How to add to Home Screen)

### Android (Chrome)
1. Open the site: `https://kcool28.github.io/<REPO_NAME>/`  
2. Tap the **⋮** menu
3. Tap **Add to Home screen** (or **Install app**)
4. Confirm

### iPhone (Safari)
1. Open the site in **Safari** (not Chrome)
2. Tap **Share** (square with arrow)
3. Tap **Add to Home Screen**
4. Confirm

> If install doesn’t show up, refresh once, then wait ~10–30 seconds for the service worker + manifest to register.

---

## Key Wiring (Important!)
### index.html
- Links `styles.css`, `app.js`
- Registers service worker `sw.js`
- Links manifest `manifest.webmanifest`
- Loads icons from `/icons/`

### manifest.webmanifest
- Must point to the correct icon paths
- Controls name, theme colors, display mode (`standalone`)

### sw.js
- Enables install + caching (PWA behavior)
- If changes don’t show up, you may be seeing cached assets

---

## Debug / Fixes (When things act haunted)

### “It’s not updating” / stale files
Service worker cache can cause old UI to stick around.

Quick fix:
- On mobile: open the site → refresh twice  
- Or: clear site data (Chrome)  
  - Settings → Site settings → Storage → find the site → Clear

### If headlines stop loading
This project uses a **Cloudflare Worker proxy**.
If the UI shows something like:
- `Worker says: Not found`
- mentions routes like `/health` or `/gdelt?...`

Then the worker route may be wrong or temporarily down.
(We previously hit a “gdelt vs gedl” typo-type issue.)

### If the doom bars turn into “pips” or weird circles
That’s usually CSS affecting:
- width/height of the bar fill
- border-radius / overflow
- background layers or masks

Last known good approach: keep bar styling simple and avoid experimental gradients that break mobile rendering.

---

## About Modal (Tone + Content)
The “About” button should show:
- App name + version
- A calming line (like: “Take a breath. It’s all ok.”)
- Joke company name (ex: **DoomWorks Interstellar** / “Everything Is Fine, LLC”)
- A reminder that this doesn’t predict the future—just reads dramatic headlines

---

## Next Milestone
🎯 **Make this dead-simple for my daughter to use on iPhone**:
- Confirm install flow works reliably in Safari
- Confirm icon + name show correctly on home screen
- Confirm “standalone” mode works (no browser UI)
- Confirm refresh works and articles update

---

## Notes from the Journey (so we don’t relive it)
- The app DID work end-to-end: headlines + doom meter + click-through links.
- A weird “purple bleed” background artifact showed up behind bars at one point.
- Attempts to patch CSS sometimes removed the bleed but broke the bars.
- The correct move was: **stabilize first, ship later.**

---

## Versioning
App displays a version string in the UI footer (example: `v3.1.x`).
Keep that updated when making changes so we can tell what’s actually deployed.

---

## License
Personal project. All doom is fictional. The universe remains weird.
