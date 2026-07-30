# Overmapper

Turn a GPX track and a background photo into a clean, shareable poster: an abstract route line, distance, visited-country flags, and more — all rendered entirely client-side in the browser.

## Features

**Input**

- Drag & drop (or pick) a GPX file and a background photo
- Pan & zoom the background image to frame it exactly how you want

**On the poster**

- Abstract, minimalist route line with adjustable colour, plus start and finish markers
- Title, up to 60 characters, wrapped over two lines when it gets long
- Distance, elevation gain and duration — read straight from the track, each shown or hidden on its own
- Flags of the countries the route passed through, with optional faint outlines of their borders
- Optional elevation profile, plotted over travelled distance rather than point index
- Fixed, watermark-style logo

Elevation gain is summed with a 5 m threshold, so GPS jitter does not inflate it into
fantasy numbers. Duration is summed per track segment, so a stopped recording between
two segments is not counted as time on the move. If a GPX file carries no elevation or
no timestamps, the affected switches are disabled and say why.

**Layout**

The poster is a fixed vertical stack — title, route, elevation profile, then a bottom row
of stats and flags. Every block is measured before the one above it is placed, so nothing
can collide no matter how many flags or stats are shown. Type and flags scale with the
poster's short edge, so landscape formats stay in proportion.

**Output**

- Export as PNG, with aspect ratio (4:5, 9:16, 1:1, 16:9, or your own) and resolution picked independently
- Distance and elevation in metric (km/m) or imperial (mi/ft) units
- German/English interface, remembered between visits
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
