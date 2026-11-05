import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appliedGameTranslation, gameViewportCorrection } from './viewportAlignment';

test('reads Chromium CSSOM serialization of zero and nonzero translations', /** 验证 Chromium CSSOM 中零位移与非零位移的序列化解析。 */ () => {
  assert.equal(appliedGameTranslation('0px'), 0);
  assert.equal(appliedGameTranslation('0px -4px'), -4);
  assert.equal(appliedGameTranslation('0 4px'), 4);
  assert.throws(/** 解析含额外旋转的平移声明，验证不支持的变换组合被拒绝。 */ () => appliedGameTranslation('0 100px rotate(5deg)'), /未知 translate/);
});

test('normalizes only the observed small navigation offset', /** 验证只归一已观察到的小幅导航位移。 */ () => {
  assert.equal(gameViewportCorrection(4, 0), -4);
  assert.equal(gameViewportCorrection(0, -4), -4);
  assert.equal(gameViewportCorrection(-4, 0), 4);
  assert.throws(/** 计算过大的正向视口校正，验证异常位移会被拒绝。 */ () => gameViewportCorrection(100, 0), /超出可归一/);
  assert.throws(/** 计算超出支持范围的视口校正，验证异常位移不会被接受。 */ () => gameViewportCorrection(-100, 0), /超出可归一/);
});
