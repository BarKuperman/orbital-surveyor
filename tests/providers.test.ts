import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BUILTIN_PROVIDERS,
  RAILWAY_STYLES,
  createProviderCatalog,
  getRailwayProviderId,
  mergeProviderCatalog,
  parseCustomProviders,
  resolveDefaultProvider,
} from '../src/providers';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/config';
import { applyOverlayAvailability } from '../src/state';

test('built-in providers have unique ids and one default per selectable layer', () => {
  const ids = BUILTIN_PROVIDERS.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(resolveDefaultProvider('satellite'), 'google-sat');
  assert.equal(resolveDefaultProvider('terrain'), 'mapterhorn');
});

test('OpenRailwayMap styles map to built-in railway providers', () => {
  assert.deepEqual(RAILWAY_STYLES.map((style) => style.id), [
    'standard',
    'signals',
    'maxspeed',
    'electrification',
    'gauge',
  ]);

  const catalog = createProviderCatalog(BUILTIN_PROVIDERS, {});
  for (const style of RAILWAY_STYLES) {
    const provider = BUILTIN_PROVIDERS.find((candidate) => candidate.id === style.providerId);
    assert.equal(getRailwayProviderId(style.id), style.providerId);
    assert.equal(provider?.resolver.kind, 'openrailwaymap');
    assert.equal(catalog[style.providerId].layers.railway?.configured, true);
    assert.equal(catalog[style.providerId].layers.railway?.tileSize, 256);
    assert.equal(catalog[style.providerId].layers.railway?.maxZoom, 19);
  }
});

test('railway settings normalize and unavailable railway providers suppress only that overlay', () => {
  const invalid = mergeSettings({ ...DEFAULT_SETTINGS, railwayStyle: 'unknown' });
  assert.equal(invalid.railwayStyle, 'standard');

  const settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    satelliteEnabled: true,
    railwayEnabled: true,
    railwayStyle: 'signals',
    railwayOpacity: 2,
  });
  const catalog = createProviderCatalog(
    BUILTIN_PROVIDERS.filter((provider) => provider.id !== 'openrailwaymap-signals'),
    {},
  );
  const effective = applyOverlayAvailability(settings, {
    ok: true,
    ready: true,
    status: 'ready',
    providers: catalog,
  }, null, catalog);

  assert.equal(settings.railwayOpacity, 1);
  assert.equal(mergeSettings({ ...DEFAULT_SETTINGS, railwayAboveTracks: true }).railwayAboveTracks, true);
  assert.equal(effective.railwayEnabled, false);
  assert.equal(effective.satelliteEnabled, true);
});

test('custom provider resolves URL secrets and request headers privately', () => {
  const result = parseCustomProviders([
    {
      id: 'secured-imagery',
      label: 'Secured Imagery',
      layer: 'satellite',
      url: 'https://tiles.example.test/{z}/{x}/{y}?key={apiKey}',
      environment: { apiKey: 'TEST_API_KEY' },
      request: {
        headers: {
          Referer: 'https://example.test/',
          Authorization: 'Bearer {apiKey}',
        },
      },
      attribution: 'Imagery © Test',
      tileSize: 256,
      maxZoom: 20,
    },
  ], { TEST_API_KEY: 'secret value' });

  assert.deepEqual(result.errors, []);
  assert.equal(result.providers[0].resolver.kind, 'custom-template');
  if (result.providers[0].resolver.kind !== 'custom-template') assert.fail('Unexpected resolver');
  assert.match(result.providers[0].resolver.urlTemplate, /secret%20value/);
  assert.equal(result.providers[0].resolver.headers.Authorization, 'Bearer secret value');

  const catalog = createProviderCatalog(result.providers, { TEST_API_KEY: 'secret value' });
  const serialized = JSON.stringify(catalog);
  assert.equal(catalog['secured-imagery'].layers.satellite?.configured, true);
  assert.doesNotMatch(serialized, /secret value|secret%20value|Authorization|tiles\.example/);
});

test('missing environment values retain the provider as unavailable', () => {
  const result = parseCustomProviders([
    {
      id: 'missing-key',
      label: 'Missing Key',
      layer: 'satellite',
      url: 'https://tiles.example.test/{z}/{x}/{y}?key={apiKey}',
      environment: { apiKey: 'MISSING_KEY' },
      attribution: 'Imagery © Test',
    },
  ], {});

  assert.deepEqual(result.errors, []);
  const catalog = createProviderCatalog(result.providers, {});
  assert.equal(catalog['missing-key'].layers.satellite?.configured, false);
  assert.equal(catalog['missing-key'].layers.satellite?.availabilityReason, 'missing_environment');
  assert.equal(
    mergeProviderCatalog(catalog)['missing-key'].layers.satellite?.availabilityReason,
    'missing_environment',
  );
});

test('terrain providers require a supported encoding', () => {
  const result = parseCustomProviders([
    {
      id: 'bad-terrain',
      label: 'Bad Terrain',
      layer: 'terrain',
      url: 'https://terrain.example.test/{z}/{x}/{y}.png',
      attribution: 'Terrain © Test',
    },
  ], {});

  assert.match(result.errors[0], /encoding/);
  assert.equal(result.providers.length, 0);
  assert.deepEqual(result.issues, [{
    id: 'bad-terrain',
    label: 'Bad Terrain',
    layer: 'terrain',
    reason: 'invalid_configuration',
  }]);
});

test('custom providers reject reserved ids, missing XYZ placeholders, and unsafe headers', () => {
  const result = parseCustomProviders([
    {
      id: 'osm',
      label: 'Collision',
      layer: 'satellite',
      url: 'https://example.test/{z}/{x}/{y}.png',
      attribution: 'Test',
    },
    {
      id: 'missing-y',
      label: 'Missing Y',
      layer: 'satellite',
      url: 'https://example.test/{z}/{x}.png',
      attribution: 'Test',
    },
    {
      id: 'unsafe-header',
      label: 'Unsafe Header',
      layer: 'satellite',
      url: 'https://example.test/{z}/{x}/{y}.png',
      request: { headers: { Host: 'other.example.test' } },
      attribution: 'Test',
    },
  ], {});

  assert.equal(result.providers.length, 0);
  assert.match(result.errors.join('\n'), /duplicate or reserved/);
  assert.match(result.errors.join('\n'), /\{z\}, \{x\}, and \{y\}/);
  assert.match(result.errors.join('\n'), /forbidden request header/);
});

test('saved custom ids survive normalization and unavailable providers suppress only their overlay', () => {
  const settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    satelliteProvider: 'saved-custom',
    satelliteEnabled: true,
    terrainEnabled: true,
  });
  const catalog = createProviderCatalog(BUILTIN_PROVIDERS, {});
  const health = {
    ok: true,
    ready: true,
    status: 'ready',
    providers: catalog,
  };
  const effective = applyOverlayAvailability(settings, health, null, catalog);

  assert.equal(settings.satelliteProvider, 'saved-custom');
  assert.equal(effective.satelliteEnabled, false);
  assert.equal(effective.terrainEnabled, true);
});

test('shipped custom provider examples pass the production validator', () => {
  const source = readFileSync(new URL('../custom-providers.example.json', import.meta.url), 'utf8');
  const examples: unknown = JSON.parse(source);
  const result = parseCustomProviders(examples, {});

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.providers.map((provider) => provider.id), ['custom-esri', 'custom-mapterhorn']);
  const catalog = createProviderCatalog(result.providers, {});
  assert.equal(catalog['custom-esri'].layers.satellite?.configured, true);
  assert.equal(catalog['custom-mapterhorn'].layers.terrain?.configured, true);
});
