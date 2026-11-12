# MiyaMusicMaker 1.0.0

A portable build of the sampler, tracker, and song arranger. The program serves the built site on this computer and opens `/music`. It is the same instrument as the one in the browser.

Make music every day. A little time at the instrument keeps you creative, and it keeps you at one with God's creation.

The playing guide is [app/src/pages/MusicMaker/README.md](../../app/src/pages/MusicMaker/README.md). This page is how to install the program and how to build it.

The app is AGPL-3.0. See [app/LICENSE](../../app/LICENSE). The chord-panel section of the playing guide is released under the [Source Seppuku License](https://wiki.remilia.org/Source_Seppuku_License).

## Mac

The Apple Silicon build is the zip on the GitHub release `MiyaMusicMaker-v1.0.0`.

1. Download `MiyaMusicMaker-1.0.0-mac-arm64.zip`.
2. Unzip it.
3. The first time, right-click `MiyaMusicMaker.app` and choose Open, then Open again.

The app is signed on this machine so Apple Silicon can run it. It is not notarized, so Gatekeeper says an unidentified developer made it. Right-click Open is the way past that. An Intel Mac is not in that zip. Build it from this source with `npm run dist:mac:x64`.

Click the instrument once before it will make sound. Rec mic uses the microphone. The computer keyboard plays the pads. A USB MIDI controller is more reliable in Chrome than in this program.

## Windows

Build the portable exe on a PC, from this tag:

```bash
cd app
corepack yarn
set VITE_CHAT_URL=https://chat.miyamaker.com
corepack yarn build
cd ../desktop/miyamusicmaker
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

`npm run dist:mac` writes an Apple Silicon zip. `npm run dist:mac:x64` writes the Intel zip. The icon is scaled up from `app/src/assets/icon/music_maker.png` when the build runs on a Mac.

To work against the Vite dev server instead of the built site:

```bash
cd desktop/miyamusicmaker
npm install
npm run dev
```

The dev server has to already be running at `http://localhost:5173`.

## What the shell does

`main.js` serves `app/dist` on `127.0.0.1` and loads `/music`. A link that leaves that address opens in the system browser. The window is large enough for the instrument, which stays 1180 by 760 inside the desk. Sample recording asks for the microphone. The Mac build's signature is ad-hoc (`identity` `-`), with the entitlements in `build/`.
