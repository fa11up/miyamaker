# Miya pfp engine

Miya pfp engine is the original Miladykakis PFP collection engine, with its existing generation, metadata, layer editing, Output management, Manual Maker, Edit Trait, and Phase 2 tools retained. The standalone AI Chef tab has been removed. The engine keeps its original browser canvas generator and Node.js server; it is not a static HTML app.

## Run locally

Install Node.js 20 or newer, then run:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). Add or select your artwork in `layers/`, configure scenarios, then use **Run Generation**. Generated images and metadata are stored under `build/`.

On first run, the online-ready version installs the bundled MiyaMaker layer set into the working `layers/` folder. It includes the 12 Koolskull layer groups (including nested subfolders), in the order defined by the source project. The images are kept as PNGs, capped at 512 px on the longest edge to match the engine's export size, and retain transparency. The bundle is sourced from [Koolskull's MiyaMaker layers](https://koolskull.com/miyamaker/layers/) (the two zero-byte files listed by the source are skipped). See [MiyaMaker Traits](https://www.miyamaker.com/traits) for the trait reference.

The source images are recorded in `assets/default-layers.manifest.json`. On macOS, rebuild the resized bundle with `node scripts/fetch-koolskull-default-layers.js`.

**New Project** clears the working layer folders and generated output and stays empty after a server restart. It does not delete the bundled defaults. Open or import a saved project to restore that project's own layers and settings. If a user already has a non-empty workspace on first startup, the app keeps it and does not overwrite it with the defaults.

## Projects and sessions

The toolbar provides **New Project**, **Open Project**, **Open Recent**, **Save Session** (💾), **Export Session**, and **Import Session**. Save Session stores a restorable copy in this browser and autosaves edits locally. Open Recent lists saved projects with their last update time and a preview when artwork is available. Browser storage is specific to this browser and device; export a session file for a portable backup.

Export Session downloads `<project-name>.miya-session.json`. It includes the project settings, workspace state, layer artwork, generated files, rarity and metadata configuration, and relevant interface values. Import a session from the toolbar or drop the JSON file onto the app to restore it. The app embeds project files into the session, so the folders do not need to remain at their original filesystem paths. A session can be large when it contains many images; browser storage limits vary by browser.

Save or export work before starting a new project if you want to keep it. Deployments with multiple users need separate server workspaces; this engine currently uses one shared workspace.

## Run online

The app needs a persistent Node.js server because it writes artwork, configuration, generated images, and metadata to disk. Deploy this repository to a Node.js host or build the included Docker image. Set the host port to `3000` (the server also honors `PORT`) and attach persistent storage to the application data paths below so assets and collections survive restarts:

- `layers/`
- `build/`
- `buildphase2/`
- `manualmaker/`
- `edittrait/`
- `src/config.js`
- `rarity-setup.json`

This version uses one shared workspace on the server. Use the host's access control to restrict access to your project. It is not a multi-user SaaS service.

The browser interface is served by the Node server at `/`; no extra HTML wrapper or static-site host is required. GitHub Pages alone cannot run the server-side file operations or the generation save pipeline.

### Docker

```bash
docker build -t miya-pfp-engine .
docker run --rm -p 3000:3000 -v "$PWD/layers:/app/layers" -v "$PWD/build:/app/build" -v "$PWD/buildphase2:/app/buildphase2" -v "$PWD/manualmaker:/app/manualmaker" -v "$PWD/edittrait:/app/edittrait" miya-pfp-engine
```

For a persistent deployment, configure equivalent persistent volumes in your hosting provider and preserve the two configuration paths above as well.

## Tools that use DiffusionBee

The original main AI Chef tab is not included. Phase 2 still contains its original AI image-generation controls; those local workflows require DiffusionBee installed and running on a Mac. They are not available in a Linux cloud container unless a compatible AI provider is configured separately.

## Tests

Run the existing engine test suite with:

```bash
npm test
```

The tests cover Output reindexing and shuffling, metadata, Manual Maker, Edit Trait, and Phase 2 operations.
