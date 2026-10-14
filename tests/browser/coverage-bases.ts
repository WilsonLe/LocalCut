/** Normal browser scenarios run once at the deployed base; both paths are opt-in diagnostics. */
export function selectBehaviorBases(selection = 'pages'): readonly string[] {
  if (selection === 'pages') return ['/LocalCut/'];
  if (selection === 'both') return ['/', '/LocalCut/'];
  throw new Error('LOCALCUT_TEST_BASES must be pages or both');
}

export const behaviorBases = selectBehaviorBases(
  process.env.LOCALCUT_TEST_BASES,
);
