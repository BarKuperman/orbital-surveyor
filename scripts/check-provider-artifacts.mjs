import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const modBundle = fs.readFileSync(path.join(dist, 'index.js'), 'utf8');
const proxyBundle = fs.readFileSync(path.join(dist, 'proxy.js'), 'utf8');
const decode = (...segments) => segments.flat().map((code) => String.fromCharCode(code - 17)).join('');
const protectedPlaintext = [
  decode([126, 133, 66, 63], [120, 128, 128, 120, 125], [118, 63, 116, 128, 126]),
  decode([126, 133, 132, 66, 63], [120, 128, 128, 120, 125, 118, 114], [129, 122, 132, 63, 116, 128, 126]),
  decode([125, 138], [131, 132]),
  decode([132, 135, 135, 141, 116], [115, 112, 116, 125, 122], [118, 127, 133, 75, 114, 129, 122, 135, 68]),
  's.t%3A0%7Cs.e%3Ag%7Cp.c%3A%23ff1c1c1c',
];

for (const value of protectedPlaintext) {
  assert.equal(modBundle.includes(value), false, `Protected Google value leaked into dist/index.js`);
  assert.equal(proxyBundle.includes(value), false, `Protected Google value was emitted as plaintext in dist/proxy.js`);
}

const customProvidersPresent = fs.existsSync(path.join(dist, 'custom-providers.json'));
if (process.env.CI) {
  assert.equal(customProvidersPresent, false, 'User custom-providers.json must not be packaged');
} else if (customProvidersPresent) {
  console.warn('Preserved local dist/custom-providers.json; clean CI builds verify that it is not packaged.');
}
assert.equal(fs.existsSync(path.join(dist, 'custom-providers.example.json')), true, 'Custom provider example is missing');
