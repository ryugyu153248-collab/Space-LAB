# SPACE LAB

Web-based space-mission simulation & analysis platform (STK-inspired): CesiumJS 3D globe + an in-browser orbital-mechanics,
events, SSA, coverage and reporting engine. React · TypeScript · Vite · Tailwind · Zustand · Recharts · Zod · satellite.js.
Design notes: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run / test / build
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 81 unit tests (Vitest)
npm run build      # type-check + production build -> dist/
```

## Deploy: GitHub → Vercel
1. **GitHub** – create a repo and push (`git remote add origin <url> && git push -u origin main`). `.github/workflows/ci.yml` runs tests + build on every push/PR.
2. **Vercel** – “Add New Project” → import the repo (Vite preset is detected; `vercel.json` included). Build `npm run build`, output `dist`.
   Every push to `main` deploys; PRs get preview URLs.
3. **Environment variable** (optional): `VITE_CESIUM_ION_TOKEN` in Vercel → Project → Settings → Environment Variables enables Cesium World Imagery + Terrain (otherwise offline NaturalEarthII imagery). Never commit it.

No backend or database is needed: scenarios are stored in the browser (IndexedDB) and can be exported/imported as JSON files (schema-versioned).

## Workspace (STK-style)
Object browser tree (per-object show/hide) · 3D window + 2D map window (ground tracks, footprints, day/night terminator, click = target) ·
Timeline view (sunlight/umbra, access, burns, events, TCA bars with draggable cursor) · right dock with Info / Maneuver / Conjunction / Events / Coverage / Reports ·
full-screen Model view. Imagery: Esri World Imagery (keyless, online) over the offline base; set `VITE_CESIUM_ION_TOKEN` to use Cesium imagery + terrain instead.
Note: Esri World Imagery is subject to Esri's terms of use/attribution — switch it off (Layers) or use a Cesium Ion token for commercial deployments.

## Earth rendering (CesiumJS only — no second globe renderer)
| Element | Source / method | Needs network? |
|---|---|---|
| Surface imagery | Esri World Imagery (keyless) over offline NaturalEarthII; Cesium World Imagery with `VITE_CESIUM_ION_TOKEN` | online (offline fallback bundled) |
| Terrain | Cesium World Terrain with token; otherwise AWS Terrain Tiles (Terrarium) as a Cesium heightmap provider, LOD/streaming by Cesium, exaggeration slider | online |
| Atmosphere / limb / terminator | Cesium sky + ground atmosphere (per-fragment, HDR), dynamic sun lighting from the simulation clock | no |
| Night lights | NASA GIBS VIIRS Black Marble (night side only) | online |
| Clouds | **procedural** (seamless fractal noise, offline) — *not* real weather | no |
| Sun, Moon, stars, Earth shadow | Cesium sun/moon/skybox; umbra cone from the same low-precision Sun used for eclipses | no |
Every layer is toggleable; line width/opacity/colour, cloud/shadow/heatmap opacity, atmosphere strength and terrain exaggeration are adjustable (Layers → Style).
Cameras: Earth overview, Low-Earth-orbit view, Satellite follow, Model close-up, Orbit, Ground-station, Relative, Dual, Global-coverage, Free (eased transitions).

## What is implemented
| Phase | Features |
|---|---|
| 1 Core | 3D Earth/Sun lighting, TLE import (validated), classical elements, SGP4, ECI/ECEF/WGS84, orbit paths, ground track, simulation clock (play/pause/stop/reverse/reset, 0.1–10000×), dashboard |
| 2 Ground/Access | multiple stations, elevation mask, az/el/range, AOS/LOS/max-el passes, visibility circle, link line |
| 3 Maneuvers | RK4 numerical propagator (two-body, J2, drag), impulsive & finite burns in 6 directions, Hohmann, plane change, rocket equation, propellant limit, before/after comparison, burn vector & plume |
| 4 SSA | conjunction screening + golden-section TCA, RIC components, 2-D Pc (needs covariance), risk colours, avoidance preview / min-Δv search / apply, simplified debris collision |
| 5 Events | event engine (create/edit/delete/duplicate/schedule/dependencies/priority): burn, attitude, deployment, collision, docking (criteria check), re-entry; eclipse (conical shadow), attitude/slew/sensor footprint, nadir-pointing coverage heatmap in a Web Worker + target windows, simulated telemetry, SAA & solar-storm scenario |
| 6 Output | PNG (1–4×, overlays, hide UI), WebM/MP4 video (MediaRecorder), automatic event recording, CSV/JSON, access/conjunction/maneuver/mission reports (HTML), scenario manager (IndexedDB, JSON import/export) with schema versioning |

Initial demo: **LEO Collision Avoidance Demonstration** — states are *designed from geometry* (see `engine/data/demoScenario.ts`); the TCA, miss
distance and avoidance Δv are *outputs* of the analysis (the avoidance burn is created disabled; enable it to see “after”).

## Honest status: prototypes & limitations
- **Prototype / simplified:** docking (range & relative-speed criteria + CW two-impulse planner, no contact dynamics), debris model (isotropic Gaussian ejection, momentum-conserving), re-entry (drag decay to 100 km; no heating/impact point), telemetry/radiation/SAA/solar storm (SIMULATED), visibility circle (spherical approximation).
- **Not implemented:** station keeping, RF link budget & inter-satellite links, constellation designer, SRP, third-body gravity, glTF models (satellites are points), drag-resize of panels, ffmpeg MP4 transcoding (MP4 only where the browser encodes it), layer colour/width editing, real space-weather feeds.
- Frames: ECI ≙ TEME axes; ECEF via GMST (UT1≈UTC, no polar motion). Sun is low-precision (~0.01°). Atmosphere is a static exponential model.
- Pc is only computed from **user-supplied** covariances; otherwise the UI says it is not assessable (colours are then miss-distance screening levels).
- After the first burn the TLE/elements are *not* reused: a numerical trajectory restarts from the state at burn time. For TLE satellites the SGP4→numerical model switch can differ by km/day; “before” in comparisons uses the same numerical dynamics without burns.
- Bundled ISS TLE is a historic (2008) sample. Paste fresh TLEs from CelesTrak/Space-Track.
- Analyses run on the main thread except coverage (Web Worker); screening many objects over long windows can take seconds.
