# Overmapper

Turn a GPX track and a background photo into a clean, shareable poster: an abstract route line, distance, visited-country flags, and more — all rendered entirely client-side in the browser.

## Features

- Upload a GPX file and a background photo
- Abstract, minimalist route rendering with adjustable color
- Pan & zoom the background image to frame it exactly how you want
- Title, distance, and country flags — each independently shown or hidden
- Optional faint outlines of the countries your route passed through
- Export as PNG in common social/mobile formats (4:5, 9:16, 1:1, 16:9)
- Fixed, watermark-style logo
- Runs 100% in the browser — no backend, no accounts, no data ever leaves your device

## Usage

Open `index.html` directly in a browser, or serve the folder with any static file server, e.g.:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## About this project

This app was built almost entirely through conversation with [Claude](https://claude.com) (Anthropic's AI assistant) — from the initial concept through iterative design feedback, feature additions, a security review, and this repository itself. It is an AI-generated / AI-assisted project.

## Third-party assets

- [flag-icons](https://github.com/lipis/flag-icons) (MIT license, see `data/flags/LICENSE`) — country flag graphics
- [Inter](https://github.com/rsms/inter) font (SIL Open Font License)
- A simplified [Natural Earth](https://www.naturalearthdata.com/) countries dataset (public domain) — used for country-border detection
