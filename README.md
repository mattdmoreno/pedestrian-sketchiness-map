# Pedestrian sketchiness map

This repo will generate a **normal-looking basemap** for Seattle from OpenStreetMap data and package it as **PMTiles** (vector tiles).

The current setup builds an **OpenMapTiles-compatible** tileset using **Planetiler** (via Docker).

## Prerequisites

- Docker Desktop (for running Planetiler)
- `curl`
- Node.js (for the Next.js app)
- `pnpm` (recommended; or enable via `corepack`)

## Build the Seattle basemap (PMTiles)

1) Download the Seattle OSM extract (PBF):

```sh
./scripts/get-seattle-osm-pbf.sh
```

2) Build the basemap PMTiles:

```sh
./scripts/build-seattle-basemap.sh
```

Outputs:
- `data/Seattle.osm.pbf`
- `data/basemap-seattle.pmtiles`

## Serve locally (for testing)

PMTiles requires an HTTP server that supports **Range requests**.

From the repo root:

This repo’s dev script starts a tiles server automatically (see below), but you can also run it directly:

```sh
pnpm dev:tiles
```

Then your PMTiles is available at:
- `http://localhost:8080/basemap-seattle.pmtiles`

## Run the web app (Next.js)

Install deps:

```sh
pnpm install
```

Start dev (runs Next.js + tile server together):

```sh
pnpm dev
```

## Host on GitHub Pages (static) (Option A)

This project can be hosted as a fully static site on GitHub Pages.

Important constraints:
- GitHub Pages serves static files only (no PostGIS / no API routes).
- PMTiles are fetched via HTTP Range requests; GitHub Pages generally works for this.
- The GitHub Actions workflow does **not** generate tiles; it expects the PMTiles to be present in `public/` (committed).

Steps:

1) Generate the tiles locally:

```sh
./scripts/run-analysis.sh
./scripts/export-sketchiness-tiles.sh
```

2) Copy PMTiles into `public/` so they get deployed:

```sh
chmod +x ./scripts/copy-tiles-to-public.sh
./scripts/copy-tiles-to-public.sh
```

3) Commit the `public/*.pmtiles` files and push to `main`.

4) In GitHub repo settings:
- Settings → Pages → Build and deployment → Source: **GitHub Actions**

The deployed site will be at:
- `https://<your-user>.github.io/<repo-name>/`

## Notes

- Planetiler’s OpenMapTiles profile downloads additional global sources (Natural Earth, water polygons, etc.). These are cached under `data/`.
- OSM attribution is required in the frontend UI: “© OpenStreetMap contributors”.
