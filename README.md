# Passport Photo Printer

[![CI](https://github.com/TimoSchoenberger/passport-photo-printer/actions/workflows/ci.yml/badge.svg)](https://github.com/TimoSchoenberger/passport-photo-printer/actions/workflows/ci.yml)
[![Security](https://github.com/TimoSchoenberger/passport-photo-printer/actions/workflows/security.yml/badge.svg)](https://github.com/TimoSchoenberger/passport-photo-printer/actions/workflows/security.yml)
[![Container](https://img.shields.io/badge/ghcr.io-container-blue?logo=docker)](https://github.com/TimoSchoenberger/passport-photo-printer/pkgs/container/passport-photo-printer)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A small Svelte application for manually cropping a photo and arranging identical copies on photo paper. The default is eight **35 × 45 mm** portraits on a **150 × 100 mm** sheet: four columns and two rows, with 2 mm spacing and at least 2 mm outer margins. It is intended for cropping and printing, with no passport compliance checks.

Photos are processed in your browser. A small Node server serves the built application and handles the **Save to Immich** button, keeping the Immich API key off the browser. No database, paid service, or runtime npm dependencies are needed.

The editor supports preset or custom photo dimensions, adjustable copies, spacing and margins, optional cutting marks, and 10 × 15 cm, 4 × 6 inch, or A4 paper. Export a 300 DPI JPEG, download a PDF with physical page dimensions, or print directly. Common browser image formats work, and HEIC conversion happens locally; if a particular HEIC file cannot be decoded, export it from Immich as JPEG first.

Turn on **Passport guide** for a combined minimum/maximum head outline, eye area, and centerline over the crop. It is a visual positioning aid based on a 35 × 45 mm template, not a compliance check; other aspect ratios stretch the guide. It never appears in the print preview, downloaded files, or Immich uploads.

When the requested copies do not fit, the count automatically decreases to the largest supported grid that fits the selected paper, photo dimensions, spacing, and margins. It does not increase again automatically. If even one photo cannot fit, the app explains the layout problem instead of creating a blank sheet.

## Run with Docker

Download `compose.yaml` and `.env.example` from the latest release, rename
`.env.example` to `.env`, and edit the Immich settings if desired. Then run:

```sh
docker compose pull
docker compose up -d
```

Open `http://YOUR-SERVER:8095`. The app works without Immich configuration; image selection, cropping, and print-sheet generation remain available.

The Compose file uses the public multi-platform image
`ghcr.io/timoschoenberger/passport-photo-printer:latest`. Set
`IMAGE_TAG=v1.0.0` in `.env` to pin a release instead of following `latest`.
Images are published for AMD64 and ARM64 with an SBOM, build provenance, and a
GitHub artifact attestation. The container runs as a non-root user, uses a
read-only filesystem, drops Linux capabilities, and exposes a health check at
`/api/health`.

For updates, run `docker compose pull && docker compose up -d`. Use
`docker compose logs -f` to inspect startup or `docker compose down` to stop
it. There is no app database or persistent container storage.

To build locally from a cloned repository instead, run
`docker compose up -d --build`.

## Install on a phone

Passport Photo Printer is a progressive web app. Open it in Safari, Chrome, or
another modern browser and choose **Add to Home Screen** or **Install app** from
the browser menu. It opens like a standalone app and keeps its application
shell available offline; photo processing still happens only on your device.
Saving to Immich naturally requires a connection to this server and Immich.

Browsers require a secure context for installation and service workers. Serve
the app over HTTPS on phones (for example through your existing reverse proxy
with a trusted certificate). Plain HTTP generally works for normal browsing on
your LAN, but not for reliable PWA installation. After an update, the app shell
refreshes automatically when the new service worker takes control.

## Immich setup

In Immich, open your account settings and create an API key with **`asset.upload`**, **`tag.create`**, and **`tag.asset`** permissions. The image will be saved and tagged in the library belonging to that key's user. `tag.read` is useful for inspecting tags but is not required by the save workflow. Configure these values in `.env`:

```dotenv
IMMICH_URL=http://192.168.1.10:2283
IMMICH_API_KEY=your-api-key
IMMICH_PUBLIC_URL=https://photos.home.example
```

`IMMICH_URL` is the address reachable **from the app container**. It can end at the server root or `/api`; both are supported. `localhost` inside this container does not refer to the host or another container. Use your server's LAN address, or an Immich service name when both containers share a Docker network.

`IMMICH_PUBLIC_URL` is optional. Set it to the address you use in your browser to enable an **Open in Immich** link after saving. The internal server URL and API key are never returned to the browser. Restart/recreate the container after changing settings:

```sh
docker compose up -d
```

Saving sends the generated JPEG print sheet by default. The menu beside the button also lets you save a single cropped photo. Both receive the tags **`pass photo`** and the selected **photo format**, for example **`35x45 mm`** or **`50.8x50.8 mm`**. This describes the individual photo dimensions, not the sheet size. Existing tags are reused, and other tags are preserved.

Identical image bytes use a stable identifier so repeated saves can be recognized as duplicates. Tags are also applied to that existing asset when Immich reports a duplicate, which lets a repeated save complete tagging after a temporary failure. An edited crop or changed sheet can create a new asset. If the photo saves successfully but tagging fails, the app reports that the image is saved and that its tags could not be confirmed; it retains the saved-asset link.

The upload integration uses Immich's `POST /api/assets` endpoint and its standard multipart fields, followed by `PUT /api/tags` to upsert the tag names and `PUT /api/tags/assets` to attach them idempotently. See the [official Immich file-upload guide](https://docs.immich.app/guides/python-file-upload/), [tag API implementation and permissions](https://github.com/immich-app/immich/blob/main/server/src/controllers/tag.controller.ts), and [API-key settings documentation](https://docs.immich.app/features/user-settings/).

### Docker secrets

Instead of setting `IMMICH_API_KEY`, the server can read a key from `IMMICH_API_KEY_FILE`. Leave `IMMICH_API_KEY` empty and add these entries to your Compose file:

```yaml
services:
  passport-photo-printer:
    # Keep the existing build, ports, and other settings.
    environment:
      # Keep IMMICH_URL and any other existing environment entries.
      IMMICH_API_KEY_FILE: /run/secrets/immich_api_key
    secrets:
      - immich_api_key

secrets:
  immich_api_key:
    file: ./secrets/immich-api-key.txt
```

Put only the API key in that file. Do not configure a nonempty `IMMICH_API_KEY` and `IMMICH_API_KEY_FILE` together. The `secrets` directory and `.env` files are excluded from the Docker build context.

## Reverse proxy

Forward the entire app origin, including `/api`, to port 3000 in the container. Set `PUBLIC_ORIGIN` to the app's browser-facing origin, for example:

```dotenv
PUBLIC_ORIGIN=https://passport.home.example
```

This is the printer application's URL, not the Immich URL. It enables strict upload Origin checking when HTTPS is terminated by your reverse proxy. The app is designed to run at the root of its own origin, rather than under a URL subdirectory.

This is a home-server app with no built-in account system. Anyone who can access it can use its configured Immich upload button. Keep it on your trusted network, or apply authentication at your reverse proxy if publishing it outside that network. Cross-origin browser uploads are refused; the server does not expose an arbitrary URL proxy.

## Print at the correct size

Select a photo or drop it into the app, select the crop format, adjust the crop, and inspect the repeated print sheet. The default 35 × 45 mm ratio is a preset; selecting a ratio alone does not certify that a photo meets a country's passport requirements.

For exact dimensions, choose the same paper size in the application and in your printer settings, and print at **100% / actual size**. Disable automatic enlargement, overscan, or borderless expansion. Avoid “fill page” options that crop the sheet. Many papers sold as “10 × 15” are actually **4 × 6 inches (101.6 × 152.4 mm)**; use a matching sheet preset when your pack lists those dimensions.

When ordering a lab print from the exported JPEG, choose a mode that keeps the entire image and check the lab's actual paper dimensions. The PDF is preferable for direct printing with explicit physical page dimensions. A printer or lab can still alter scaling, so measure the first print before making many copies.

## Local development

Install Node.js 24 LTS, then:

```sh
npm ci
npm run dev
```

The development server proxies `/api` to `http://127.0.0.1:3000`. In a second terminal, start the backend for config and Immich saving:

```sh
node --env-file-if-exists=.env server/index.mjs
```

For a production build without Docker:

```sh
npm run check
npm test
npm run build
node --env-file-if-exists=.env server/index.mjs
```

Open `http://localhost:3000`. `npm start` also starts the production server and loads `.env` if present; environment variables already supplied by your shell or process manager take precedence.

## Verification and releases

Every push and pull request runs Svelte diagnostics, unit/server tests, a
production build, and a Docker build. Pull requests also receive dependency
review. A separate security workflow runs CodeQL, npm audit, Trivy source/image
scans, and OpenSSF Scorecard on every change and weekly against newly disclosed
issues. GitHub Actions are pinned to immutable commit hashes.

Dependabot checks npm, the Docker base image, and GitHub Actions weekly and
opens grouped update pull requests. It was chosen over Renovate for this small
repository because it is built into GitHub and requires no separately installed
app or access token. Security updates remain ungrouped and should be reviewed
promptly.

Pushing `main` publishes `latest` and `main` container tags. Pushing a SemVer
tag such as `v1.1.0` additionally publishes `1.1.0` and `1.1` tags. Release
changes should be recorded in [CHANGELOG.md](CHANGELOG.md).

## Contributing, support, and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request and use [GitHub Discussions](https://github.com/TimoSchoenberger/passport-photo-printer/discussions)
for setup questions. The project has a [code of conduct](CODE_OF_CONDUCT.md).

Do not disclose vulnerabilities in public issues. Follow
[SECURITY.md](SECURITY.md) to send a private report. This project is licensed
under the [MIT License](LICENSE). Production builds include the bundled
dependencies' license texts at `/third-party-licenses.txt`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PORT` | `8095` | Host port used by Docker Compose. |
| `HOST` | `0.0.0.0` | Node server bind address. |
| `PORT` | `3000` | Node server port; leave unchanged in the supplied container. |
| `IMMICH_URL` | empty | Internal Immich root URL or `/api` URL. |
| `IMMICH_API_KEY` | empty | API key with `asset.upload`, `tag.create`, and `tag.asset`. |
| `IMMICH_API_KEY_FILE` | empty | Alternative path to a file containing the API key. |
| `IMMICH_PUBLIC_URL` | empty | Browser-facing Immich URL for saved-asset links. |
| `PUBLIC_ORIGIN` | direct server origin | Explicit browser origin for uploads behind a reverse proxy. |
| `MAX_UPLOAD_BYTES` | `20971520` | Maximum JPEG sheet upload size (20 MiB by default; maximum 100 MiB). |
| `IMMICH_TIMEOUT_MS` | `45000` | Maximum time to wait for an Immich upload. |

Immich settings are read when the Node process starts. There are no credentials in the frontend build. The upload is kept in memory only for the request and is not saved to the container filesystem.

## HTTP interface

- `GET /api/health` returns `{ "status": "ok" }` for container health checks. It does not test Immich availability.
- `GET /api/config` returns `immichConfigured`, `maxUploadBytes`, and optional `immichWebUrl`.
- `POST /api/immich/upload` accepts raw JPEG bytes with `Content-Type: image/jpeg`, `X-Filename`, `X-Photo-Width`, and `X-Photo-Height` headers. URL-encode the filename for Unicode characters; the dimensions are decimal millimeters between 1 and 1,000 and refer to a single photo. It returns `id`, `status` (`created` or `duplicate`), the requested `tags`, `tagsApplied`, and an optional browser `url`. A successful image save with unconfirmed tags remains HTTP 200 with `tagsApplied: false` and a `warning`. Upload errors use `{ "error": "message" }` and an appropriate HTTP status.

Automated server tests use a mock Immich server to check multipart uploads, duplicate and concurrent tagging, custom-format tag names, partial-success warnings, error responses, timeouts, upload limits, Origin checks, secret isolation, and static file serving. An actual Immich upload and Docker image execution require your running Immich and Docker environments.
