# speedfreaks.live

An independent online radio player built around AzuraCast. This project began as a student project and grew into a custom listening experience for an always-on mix of emo, screamo, alternative and indie music.

**[Open the interface preview](https://pneftekin.github.io/speedfreaks-radio/)** · **[View the source](https://github.com/pneftekin/speedfreaks-radio)**

The GitHub Pages site is a static preview. It uses sample now-playing data to show the interface; playback, song requests, and Last.fm account features need the live services and backend described below.

## What it does

- Plays a continuous AzuraCast stream with volume control.
- Shows the current track, cover art, elapsed time, progress, listeners and recent history.
- Lets listeners browse/request available tracks.
- Connects Last.fm accounts and scrobbles tracks after the listening threshold.
- Adapts to mobile screens and includes accessible labels and reduced-motion support.

## Interface

The preview uses a deliberately minimal, text-led player layout. GitHub Pages builds it in demo mode, so the page remains presentable without the private radio server or Last.fm credentials.

## Run locally

Requires Node.js 20 or newer.

```sh
npm ci
npm run dev
```

Vite serves the interface at `http://localhost:5173`. The player reads public now-playing and request data from the configured AzuraCast station in `src/api.js`.

To build the static interface:

```sh
npm run build
npm run preview
```

To build the GitHub Pages sample view locally:

```sh
VITE_DEMO_MODE=true npm run build
```

## Last.fm backend

Last.fm OAuth and scrobbling use a small Express service with SQLite-backed sessions. Copy `.env.example` to `.env`, fill in the Last.fm API credentials and a long random `SESSION_SECRET`, then start the service:

```sh
npm run backend
```

The backend listens on port `3000` by default. Configure the Last.fm callback URL to match the deployed backend and route `/api/lastfm` requests from the web host to that service. Keep `.env`, session database files, and API secrets out of source control. GitHub Pages cannot host this Node service, so it only serves the static interface preview.

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` builds the site in demo mode and deploys it on pushes to `main`. In the repository settings, select **Settings → Pages → Build and deployment → GitHub Actions**. The workflow publishes the `dist` directory.

## Built with

Vanilla JavaScript, HTML and CSS · Vite · AzuraCast · Express · SQLite · Last.fm API

## Project note

This is a personal portfolio project and a snapshot of my work on independent web radio. The public preview uses illustrative sample track data; it does not represent the station's current broadcast.