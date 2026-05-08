# Orbital Surveyor

Subway Builder mod that adds satellite and terrain raster overlays to the in-game MapLibre map. The game requests only a local proxy; the proxy fetches provider tiles and keeps API keys out of the mod bundle.

## Proxy

Create a `.env` file next to `proxy.js` using `.env.example` as a guide, then run:

```bash
node proxy.js
```

The proxy defaults to `http://127.0.0.1:8787` and exposes:

- `GET /health`
- `GET /providers`
- `GET /tiles/:provider/:layer/:z/:x/:y`

On Windows, `.\proxy.ps1` is a convenience wrapper around `node .\proxy.js`.

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

Provider API keys are read only by `proxy.js` from environment variables or `.env`.

For MapTiler terrain, the default upstream URL is:

```text
https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=...
```

Terrain mode enables MapLibre `raster-dem` terrain. Use the in-game terrain slider to control terrain exaggeration.
