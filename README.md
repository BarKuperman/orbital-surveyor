# Orbital Surveyor

Subway Builder mod that adds satellite imagery, Street View, and 3D terrain to the in-game MapLibre map.

## User Guide

1. Install [Node.js](https://nodejs.org/) if it is not already installed.
2. If you are not installing through Railyard, put the mod files in your Subway Builder mods folder.
3. Start the proxy before opening or reloading the mod by double-clicking the launcher for your OS in the mod folder:

   - Windows: `start-proxy-windows.cmd`
   - macOS: `start-proxy-macos.command`
   - Linux: `start-proxy-linux.sh`

   On Linux, if the launcher is not executable yet, run:

   ```bash
   chmod +x start-proxy-linux.sh
   ```

   You can also run `node proxy.js` manually from a terminal.

4. Leave the proxy window open while playing.
5. Enable Orbital Surveyor in Subway Builder under Settings > Mods.
6. Open the Orbital Surveyor panel in-game and enable Satellite, Terrain, or Street View as needed.

The panel includes a proxy status area at the bottom. If the proxy is not reachable after repeated health checks, overlay toggles are disabled, active overlay layers are removed, and an in-game warning is shown once per outage. If the proxy comes back during the same map session, previously requested overlays can restore after health becomes ready again.

## Optional Setup

Create a file named `.env` next to `proxy.js` if you want provider API keys, custom tile URLs, or a custom proxy port. You can copy or rename `.env.example` to `.env` and edit the values.

Add a MapTiler key if you want MapTiler imagery or terrain:

   ```text
   MAPTILER_API_KEY=your_maptiler_key_here
   PROXY_PORT=8787
   ```

Add a Google Maps key if you want the Google Map Tiles API provider:

   ```text
   GOOGLE_MAPS_API_KEY=your_google_maps_key_here
   ```

## Map Layer Filtering

The Orbital Surveyor panel is scrollable and includes a Map layers section for controlling built-in game layers while an overlay mode is active.

Map layer switches are off by default so satellite and terrain overlays are easier to see. Turn a switch on to show that specific game layer above the overlay. When overlay modes are off, the game controls its own layer visibility again, and the mod only restores layers it hid itself.

Controlled layer IDs:

- Buildings: `buildings-3d`
- Water: `water`, `ocean-depth-labels`, `general-tiles`
- Parks: `parks-large`, `parks-small`, `parks-modded`
- Roads: `road-labels`, `intersections-layer`, `road-lines`
- Airports: `airports`, `runways-taxiways`, `airports-modded`
- Area labels: `neighborhood-labels`, `suburb-labels`, `city-labels`

Use Reset in the Map layers section to return all controlled layers to the hidden-by-default overlay view.

## Street View

Street View mode shows Google's Street View availability overlay above the in-game roads. The game loads those availability tiles through the local Orbital Surveyor proxy, so Subway Builder does not need direct internet access.

When Street View mode is enabled, clicking the map opens Google Maps Street View at the clicked location in your external browser. The Street View availability overlay does not require a Google Maps API key.

## Terrain Reloads

Terrain mode is heavier than the normal map. When Subway Builder reloads its game layers, Orbital Surveyor's terrain has to reload too.

Because terrain takes longer to load, it may briefly disappear or lag behind after changing screens, switching 2D/3D view, or changing the game's map layers. It should restore automatically after a moment.

>[!WARNING]
>Tracks and stations may be less visible or briefly hidden while Terrain is enabled, especially in 3D view or during layer reloads.

## Proxy Details

The proxy defaults to `http://127.0.0.1:8787` and exposes:

- `GET /health`
- `GET /providers`
- `GET /tiles/:provider/:layer/:z/:x/:y`

`GET /health` returns general proxy readiness (`ok`, `ready`, `status`), provider configuration details, a timestamp, and proxy uptime. It does not test whether every upstream provider is reachable. The mod checks this endpoint before enabling overlays, polls it periodically, and triggers an immediate health check only when MapLibre reports proxy-backed errors that look like local proxy connectivity failures. HTTP tile responses from upstream providers, such as an OSM `502`, are logged by the proxy but do not count as proxy outages.

Provider API keys are read only by `proxy.js` from environment variables or `.env`. The default satellite provider and default terrain provider do not require API keys.

The proxy writes session logs under `logs/` in the mod folder:

- `logs/proxy-current.log`
- `logs/proxy-previous.log`

Upstream tile failures are aggregated into compact periodic summary lines grouped by provider, layer, and status or request error code. The proxy does not write one log line per failed tile.

Successful `/tiles/...` image responses use a fixed browser cache policy of `public, max-age=604800, stale-if-error=2592000`, overriding upstream tile cache headers. This lets Electron/MapLibre reuse identical tile URLs for up to 7 days and use stale cached tiles for up to 30 days on fetch errors where supported. The proxy does not store tile files on disk.

## Mod Development

```bash
pnpm install
pnpm build
pnpm dev:link
```

Enable the mod in Subway Builder under Settings > Mods. Start the proxy before enabling satellite or terrain overlays in-game.

Release builds copy `proxy.js`, `.env.example`, and the one-click proxy launchers into `dist/` alongside the mod files.

Useful checks:

```bash
pnpm typecheck
pnpm build
node --check proxy.js
```

## Providers

Built-in provider IDs:

- `google-sat`: Default Google satellite raster tiles through the local proxy. No API key required.
- `google-hybrid`: Google hybrid raster tiles through the local proxy. No API key required.
- `google-road`: Google road raster tiles through the local proxy. No API key required.
- `esri`: Esri World Imagery raster tiles through the local proxy. No API key required.
- `osm`: OpenStreetMap raster tiles through the local proxy from `https://tile.openstreetmap.org/${z}/${x}/${y}.png`. The in-game source is capped at zoom 19 so closer views overzoom instead of requesting unsupported z20+ OSM tiles.
- `mapterhorn`: Default open terrain provider using Terrarium-encoded WebP DEM tiles from `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`.
- `maptiler`: Optional MapTiler provider requiring `MAPTILER_API_KEY`; uses `satellite-v4` for imagery and `terrain-rgb-v2` DEM tiles for MapLibre 3D terrain.
- `google`: Optional Google Map Tiles API satellite tiles requiring `GOOGLE_MAPS_API_KEY`.
- `streetview`: Google Street View availability overlay through the local proxy.
- `custom`: Optional XYZ templates from `CUSTOM_SATELLITE_URL` and `CUSTOM_TERRAIN_URL`.

Orbital Surveyor's source code is licensed under MIT. Third-party map tiles,
imagery, terrain data, and Street View availability data remain subject to their
respective provider licenses, attribution requirements, and usage policies.
