# MiyaMusicMaker 1.0.0

A portable build of the sampler, tracker, and song arranger. The program opens the built site from inside itself at `app://music/music`. The instrument is the same: pads, sequencer, tracker, arranger, the mic, MIDI, and saving `.m1ya` songs and `.k1t` kits to files.

Some parts need the site's server, and they only work on the website, not in this program:

- publishing a song, kit, or bounce to Arweave, and minting it
- loading a sample from a link or a video
- the allowlist

Your songs and kits are kept between launches (in builds after 1.0.0, see below). They live in the program's own storage on this computer, the same way the website keeps them in the browser. The website and the program do not share that storage. Save a `.m1ya` or `.k1t` file to move work between them.

Upgrading from 1.0.0: version 1.0.0 opened on a new local port every launch, so each launch had its own empty storage. Work that 1.0.0 kept only in that storage cannot be recovered by a newer version. Anything you saved to a `.m1ya` or `.k1t` file is fine. Open the file in the new version.

Make music every day. A little time at the instrument keeps you creative, and it keeps you at one with God's creation.

The playing guide is [app/src/pages/MusicMaker/README.md](../../app/src/pages/MusicMaker/README.md). This page is how to install the program and how to build it.

The app is AGPL-3.0. See [app/LICENSE](../../app/LICENSE). The chord-panel section of the playing guide is released under the [Source Seppuku License](https://wiki.remilia.org/Source_Seppuku_License).

## Mac

The Apple Silicon build is the zip on the GitHub release `MiyaMusicMaker-v1.0.0`.

1. Download `MiyaMusicMaker-1.0.0-mac-arm64.zip`.
2. Unzip it.
3. Move `MiyaMusicMaker.app` to Applications if you like, then open it once. macOS will refuse it the first time.
4. On macOS 15 (Sequoia) or newer: open System Settings › Privacy & Security, scroll down to the message about MiyaMusicMaker, and click Open Anyway. Confirm with your password. On macOS 14 or older, right-click the app, choose Open, then Open again.

Or, from Terminal, in the folder that holds the app:

```bash
xattr -dr com.apple.quarantine MiyaMusicMaker.app
```

The app is signed on this machine so Apple Silicon can run it. It is not notarized, so Gatekeeper says it cannot check the developer. The steps above are the way past that, and you only do them once. An Intel Mac is not in that zip. Build it from this source with `npm run dist:mac:x64`.

Click the instrument once before it will make sound. Rec mic uses the microphone, and macOS asks for it the first time. The computer keyboard plays the pads. A USB MIDI controller is more reliable in Chrome than in this program.

## Windows

Build the portable exe on a PC, from this tag. In Command Prompt (cmd):

```bat
cd app
corepack yarn
set VITE_CHAT_URL=https://chat.miyamaker.com
corepack yarn build
cd ..\desktop\miyamusicmaker
npm install
npm run dist:win
```

In PowerShell, the variable is set another way:

```powershell
cd app
corepack yarn
$env:VITE_CHAT_URL="https://chat.miyamaker.com"
corepack yarn build
cd ..\desktop\miyamusicmaker
npm install
npm run dist:win
```

The exe is `desktop/miyamusicmaker/release/MiyaMusicMaker-1.0.0-windows.exe`. It does not need an installer.

## Linux

Build the AppImage on Linux, from this tag:

```bash
cd app
corepack yarn
VITE_CHAT_URL=https://chat.miyamaker.com corepack yarn build
cd ../desktop/miyamusicmaker
npm install
npm run dist:linux
```

The file is `desktop/miyamusicmaker/release/MiyaMusicMaker-1.0.0-linux.AppImage`. Mark it executable and run it.

## Build the Mac app from source

Node 22.18 or newer. The web app uses Yarn (`app/yarn.lock`). This folder uses npm, so Electron stays out of the web lockfile. On a Mac, Xcode or the command line tools provide `sips` and `codesign`.

```bash
cd app
corepack yarn
VITE_CHAT_URL=https://chat.miyamaker.com corepack yarn build
cd ../desktop/miyamusicmaker
npm install
npm run dist:mac
```

`npm run dist:mac` writes an Apple Silicon zip. `npm run dist:mac:x64` writes the Intel zip.

Every `dist:` script runs `prepare.js` first. It writes the icon the build uses to `build/generated/icon.png`, which git ignores. On a Mac it is scaled up from `app/src/assets/icon/music_maker.png`. Elsewhere it is a copy of the committed `build/icon.png`. It also stops the build when `app/dist` is older than the last commit to `app/src`, so a release does not pack an old site. Rebuild the site, or set `MIYA_ALLOW_STALE_DIST=1` to go on anyway.

To work against the Vite dev server instead of the built site:

```bash
cd desktop/miyamusicmaker
npm install
npm run dev
```

The dev server has to already be running at `http://localhost:5173`. If it is not, the program says so and quits.

## What the shell does

`main.js` registers an `app://` scheme and serves `app/dist` through it (`serve.js`), then loads `app://music/music`. The address is the same every launch, so the browser storage is too. It counts as a secure page, so the microphone, MIDI, and audio worklets work. Media files answer range requests, so seeking works. Anything under `/api/` is a 404, because there is no server behind it. A link that leaves `app://music` opens in the system browser. Only that page may use the microphone and MIDI. The window is large enough for the instrument, which stays 1180 by 760 inside the desk. Sample recording asks for the microphone. The Mac build's signature is ad-hoc (`identity` `-`), with the entitlements in `build/`: JIT for JavaScript, and audio input for the microphone. Nothing else.
