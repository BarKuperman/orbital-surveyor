# Orbital Surveyor

Subway Builder mod that adds satellite imagery and real 3D terrain to the in-game MapLibre map. The game requests only a local proxy; the proxy fetches provider tiles and keeps API keys out of the mod bundle.

## User Guide

1. Install [Node.js](https://nodejs.org/) if it is not already installed.
2. Put the mod files in your Subway Builder mods folder.
3. Create a file named `.env` next to `proxy.js`.
4. Add your MapTiler key:

   ```text
   MAPTILER_API_KEY=your_maptiler_key_here
   PROXY_PORT=8787
   ```

5. Optional: add a Google Maps key if you want Google satellite as an alternate provider:

   ```text
   GOOGLE_MAPS_API_KEY=your_google_maps_key_here
   ```

6. Start the proxy before opening or reloading the mod by double-clicking the launcher for your OS:

   - Windows: `start-proxy-windows.cmd`
   - macOS: `start-proxy-macos.command`
   - Linux: `start-proxy-linux.sh`

   You can also run `node proxy.js` manually from a terminal.

7. Leave the proxy window open while playing.
8. Enable Orbital Surveyor in Subway Builder under Settings > Mods.
9. Open the Orbital Surveyor panel in-game and enable Satellite, Terrain, or Street View as needed.

## Map Layer Filtering

The Orbital Surveyor panel is scrollable and includes a Map layers section for controlling built-in game layers while an overlay mode is active.

Layer switches are off by default so satellite and terrain overlays are easier to see. Turn a switch on to show that specific game layer above the overlay. Base mode restores the game's own layer visibility, and the mod only restores layers it hid itself.

Controlled layer IDs:

- Buildings: `buildings-3d`
- Water: `water`, `ocean-depth-labels`
- Parks: `parks-large`, `parks-small`
- General tiles: `general-tiles`
- Roads: `road-labels`, `intersections-layer`, `road-lines`
- Airports: `airports`,`runways-taxiways`
- Area labels: `neighborhood-labels`, `suburb-labels`, `city-labels`

Use Reset in the Map layers section to return all controlled layers to the hidden-by-default overlay view.

## Street View

Street View mode shows Google's Street View availability overlay above the in-game roads. The game loads those availability tiles through the local Orbital Surveyor proxy, so Subway Builder does not need direct internet access.

When Street View mode is enabled, clicking the map opens Google Maps Street View at the clicked location in your external browser. The Street View availability overlay does not require a Google Maps API key.

## Terrain Reloads

Terrain mode is heavier than the normal map. When Subway Builder reloads its game layers, Orbital Surveyor's terrain has to reload too.

Because terrain takes longer to load, it may briefly disappear or lag behind after changing screens, switching 2D/3D view, or changing the game's map layers. It should restore automatically after a moment.

## Proxy Details

The proxy defaults to `http://127.0.0.1:8787` and exposes:

- `GET /health`
- `GET /providers`
- `GET /tiles/:provider/:layer/:z/:x/:y`

Street View availability is available without a Google Maps API key through:

- `GET /tiles/streetview/availability/:z/:x/:y`

Provider API keys are read only by `proxy.js` from environment variables or `.env`.

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

- `maptiler`: Default satellite provider through the `satellite-v4` map, and `terrain-rgb-v2` DEM tiles for actual MapLibre 3D terrain.
- `mapterhorn`: Optional open terrain provider using Terrarium-encoded WebP DEM tiles from `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`.
- `google`: Optional Google Map Tiles API satellite tiles.
- `streetview`: Google Street View availability overlay through the local proxy.
- `custom`: Optional XYZ templates from `CUSTOM_SATELLITE_URL` and `CUSTOM_TERRAIN_URL`.

For MapTiler terrain, the default upstream URL is:

```text
https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=...
```

Terrain mode enables MapLibre `raster-dem` terrain. Use the in-game terrain slider to control terrain exaggeration.

Mapterhorn terrain uses 512px Terrarium-encoded WebP tiles. It does not need an API key.
