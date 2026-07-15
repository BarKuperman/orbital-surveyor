import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_PROVIDERS,
  createProviderCatalog,
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
