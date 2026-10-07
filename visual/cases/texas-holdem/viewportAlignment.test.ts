import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appliedGameTranslation, gameViewportCorrection } from './viewportAlignment';

test('reads Chromium CSSOM serialization of zero and nonzero translations', () => {
  assert.equal(appliedGameTranslation('0px'), 0);
  assert.equal(appliedGameTranslation('0px -4px'), -4);
  assert.equal(appliedGameTranslation('0 4px'), 4);
  assert.throws(() => appliedGameTranslation('0 100px rotate(5deg)'), /未知 translate/);
});

test('normalizes only the observed small navigation offset', () => {
  assert.equal(gameViewportCorrection(4, 0), -4);
  assert.equal(gameViewportCorrection(0, -4), -4);
  assert.equal(gameViewportCorrection(-4, 0), 4);
  assert.throws(() => gameViewportCorrection(100, 0), /超出可归一/);
  assert.throws(() => gameViewportCorrection(-100, 0), /超出可归一/);
});
