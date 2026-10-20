import test from 'node:test';
import assert from 'node:assert/strict';
import {pointWorldSize, heightRgb, heightColorBuffer, copyVertexColors, srgbToLinear} from '../src/cloud-view.js';

const linear = rgb => rgb.map(srgbToLinear);

function closeTo(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-5, `${actual[i]} vs ${expected[i]}`);
}

test('point size grows with the scan and stays in a readable range', () => {
  assert.equal(pointWorldSize(0), 0.02);
  assert.equal(pointWorldSize(Number.NaN), 0.02);
  assert.ok(pointWorldSize(2) > pointWorldSize(0.5));
  assert.ok(pointWorldSize(2) < pointWorldSize(8));
  assert.equal(pointWorldSize(100), 0.08);
});

test('height colours run from low blue to high amber and flatten a level cloud', () => {
  const [low, high] = [heightRgb(0), heightRgb(1)];
  assert.ok(low[2] > low[0]);
  assert.ok(high[0] > high[2]);
  const colors = heightColorBuffer(new Float32Array([0, 0, 0, 0, 2, 0]));
  assert.equal(colors.length, 6);
  closeTo(colors.slice(0, 3), linear(low));
  closeTo(colors.slice(3), linear(high));
  const flat = heightColorBuffer(new Float32Array([1, 4, 1, 2, 4, 2]));
  closeTo(flat.slice(0, 3), linear(heightRgb(0.5)));
});

test('captured vertex colours can be copied and restored', () => {
  const attribute = {
    count: 2,
    itemSize: 3,
    getX: i => i,
    getY: i => i + 0.25,
    getZ: () => 0.5,
  };
  assert.deepEqual([...copyVertexColors(attribute)], [0, 0.25, 0.5, 1, 1.25, 0.5]);
  assert.equal(copyVertexColors(null), null);
});

test('sRGB to linear matches the standard transfer curve', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
  assert.ok(Math.abs(srgbToLinear(0.5) - 0.214) < 0.001);
});
