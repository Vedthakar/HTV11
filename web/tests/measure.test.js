import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentLength, formatMetres} from '../src/measure.js';

test('segment length is the straight-line distance in metres', () => {
  assert.equal(segmentLength({x: 0, y: 0, z: 0}, {x: 3, y: 4, z: 0}), 5);
  assert.equal(segmentLength({x: 1, y: 2, z: 3}, {x: 1, y: 2, z: 3}), 0);
});

test('distances under a metre read in centimetres', () => {
  assert.equal(formatMetres(0.254), '25.4 cm');
  assert.equal(formatMetres(1.5), '1.50 m');
  assert.equal(formatMetres(Number.NaN), '—');
});
