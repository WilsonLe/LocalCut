import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { selectBehaviorBases } from '../browser/coverage-bases.ts';

test('behavior coverage runs once while the diagnostic matrix retains both paths', () => {
  assert.deepEqual(selectBehaviorBases(), ['/LocalCut/']);
  assert.deepEqual(selectBehaviorBases('both'), ['/', '/LocalCut/']);
  assert.throws(() => selectBehaviorBases('root-only'), /LOCALCUT_TEST_BASES/);
});

test('normal Chrome specs cannot reintroduce a hard-coded root and Pages duplicate matrix', () => {
  const directory = new URL('../browser/', import.meta.url);
  const paired = [];
  for (const name of readdirSync(directory).filter((name) =>
    name.endsWith('.spec.ts'),
  )) {
    const source = readFileSync(new URL(name, directory), 'utf8');
    if (/\[\s*['"]\/['"]\s*,\s*['"]\/LocalCut\/['"]\s*\]/.test(source))
      paired.push(name);
  }
  assert.deepEqual(
    paired,
    [],
    'Use behaviorBases and name distinct fixture variants explicitly',
  );
});
