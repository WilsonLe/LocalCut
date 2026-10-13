import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBehaviorBases } from '../browser/coverage-bases.ts';

test('behavior coverage runs once while the diagnostic matrix retains both paths', () => {
  assert.deepEqual(selectBehaviorBases(), ['/LocalCut/']);
  assert.deepEqual(selectBehaviorBases('both'), ['/', '/LocalCut/']);
  assert.throws(() => selectBehaviorBases('root-only'), /LOCALCUT_TEST_BASES/);
});
