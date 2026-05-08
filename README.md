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

6. Start the proxy before opening or reloading the mod:

   ```bash
   node proxy.js
   ```

   On Windows, you can also double-click or run:

   ```powershell
   .\proxy.ps1
   ```

7. Leave the proxy window open while playing.
8. Enable Orbital Surveyor in Subway Builder under Settings > Mods.
9. Open the Orbital Surveyor panel in-game and choose Base, Satellite, Terrain, or Both.

## Terrain Warning

Terrain mode uses MapLibre 3D terrain. While Terrain or Both mode is active, do not switch the game between 2D and 3D view and do not change the built-in in-game map layers. Subway Builder can crash if those game map controls rebuild the map while terrain is enabled.

Switch Orbital Surveyor back to Base or Satellite before changing the game 2D/3D view or built-in map layer settings.

## Proxy Details

The proxy defaults to `http://127.0.0.1:8787` and exposes:

- `GET /health`
- `GET /providers`
- `GET /tiles/:provider/:layer/:z/:x/:y`

Provider API keys are read only by `proxy.js` from environment variables or `.env`.

## Mod Development

```bash
pnpm install
pnpm build
pnpm dev:link
```

Enable the mod in Subway Builder under Settings > Mods. Start the proxy before enabling satellite or terrain overlays in-game.

Useful checks:

```bash
pnpm typecheck
pnpm build
node --check proxy.js
```

## Providers

Built-in provider IDs:

- `maptiler`: Default satellite provider through `satellite-v4`, and `terrain-rgb-v2` DEM tiles for actual MapLibre 3D terrain.
- `google`: Optional Google Map Tiles API satellite tiles.
- `custom`: Optional XYZ templates from `CUSTOM_SATELLITE_URL` and `CUSTOM_TERRAIN_URL`.

For MapTiler terrain, the default upstream URL is:

```text
https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=...
```

Terrain mode enables MapLibre `raster-dem` terrain. Use the in-game terrain slider to control terrain exaggeration.
