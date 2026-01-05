# Crosswalk Availability Map

https://michaelthoreau.github.io/pedestrian-sketchiness-map/

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

## Report an issue (Google Form)

The map supports a simple “Report an issue” link that opens a Google Form prefilled with the clicked location.

1) In Google Forms, add a short-answer question like “Location”.

2) Use **Get pre-filled link** in Google Forms, fill in any value for that question, and copy the generated URL.

3) Put that URL into an env var, replacing the location value with `{latLng}`:

```sh
# .env.local
NEXT_PUBLIC_REPORT_ISSUE_URL_TEMPLATE="https://docs.google.com/forms/d/e/1FAIpQLSfXe8xGwzD7KtYl_er0SNgElbAU2ztAXRIESZ1mxzhr-df2bg/viewform?usp=pp_url&entry.670432178={latLng}"
```

For GitHub Pages: `.env.local` is not used in CI. Instead set a GitHub Actions variable:
- Repo Settings → Secrets and variables → Actions → Variables → New repository variable
- Name: `NEXT_PUBLIC_REPORT_ISSUE_URL_TEMPLATE`
- Value: (your template URL)

Supported template tokens:
- `{latLng}` → `47.606200,-122.332100`
- `{lat}` / `{lng}`
- `{zoom}`

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
