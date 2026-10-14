import type { GoalStage } from '../src/ai/goal-review';

/** Synthetic adverse observations, never runtime output contracts. */
export const auxiliaryRoleLeaves = [
  {
    stage: 'request_contract',
    leaf: 'goal replaced by a retrospective status report',
    text: 'State verified. Nothing further is executable on my side.',
  },
  {
    stage: 'session_todos',
    leaf: 'tasks replaced by a conversational answer',
    text: 'No — I cannot generate music. Add a music file and say go.',
  },
  {
    stage: 'session_todos',
    leaf: 'completed and blocked work collapsed into a status reply',
    text: 'Retry complete. Nothing further is actionable on my side.',
  },
  {
    stage: 'session_todos',
    leaf: 'execution narration replaces task maintenance',
    text: "I'll inspect the library and patch the title now.",
  },
  {
    stage: 'session_todos',
    leaf: 'DSML tool impersonation',
    text: '<｜DSML｜ calls><｜DSML｜ invoke name="propose_edits">{}</｜DSML｜ invoke></｜DSML｜ calls>',
  },
  {
    stage: 'session_todos',
    leaf: 'XML tool impersonation',
    text: '<tool_calls><tool_call name="inspect_project">{}</tool_call></tool_calls>',
  },
  {
    stage: 'completion_check',
    leaf: 'review replaced by another user-facing answer',
    text: 'No — I cannot generate music. Here are two routes: upload music or use speech.',
  },
  {
    stage: 'session_todos',
    leaf: 'optional offer promoted to required work',
    text: '- [ ] Voiceover is required before completion.',
  },
  {
    stage: 'session_todos',
    leaf: 'routine choice promoted to a fresh approval gate',
    text: '- [ ] Add Music bed — blocked until you explicitly say go.',
  },
] as const satisfies readonly {
  stage: GoalStage;
  leaf: string;
  text: string;
}[];

export const roleArtifacts: Record<GoalStage, string> = {
  request_contract:
    '## Goal\nRetain Harbour title and Sunset ending; add Music bed.\n## Success conditions\n- Harbour title is present.\n- Sunset ending is retained.\n- Music bed exists from an available source.\n## Stop conditions\n- Music bed is blocked on a missing music source.',
  session_todos:
    '## To-dos\n- [x] Harbour title — completed, confirmed receipt.\n- [x] Sunset ending — present in current state.\n- [ ] Music bed — blocked: no source is available.',
  completion_check:
    'The candidate offer does not fulfill the goal. Harbour title and Sunset ending are supported by current state and receipts. Music bed remains incomplete and blocked on a missing music source. An offer or routine confirmation is not evidence of completion.',
};

/** Test-only semantic probes. No host parser, verdict gate or response repair.
 * Returns booleans so live checks never expose provider response bodies. */
export function roleLeafChecks(stage: GoalStage, text: string) {
  const taskContext = (name: string) => {
    const offset = text.toLowerCase().indexOf(name.toLowerCase());
    return offset < 0 ? '' : text.slice(Math.max(0, offset - 60), offset + 170);
  };
  return {
    requiredOutcomesRetained: [
      'Harbour title',
      'Music bed',
      'Sunset ending',
    ].every((name) => text.toLowerCase().includes(name.toLowerCase())),
    internalDocument:
      !/^\s*(?:I['’]ll\b|I will\b|No\s*[—-]|State verified\b|Retry (?:complete|done)\b|Nothing further\b|Confirmed\s*[—-])/i.test(
        text,
      ),
    noToolImpersonation:
      !/<(?:[｜|]\s*DSML|tool_calls?\b|function_calls?\b)/i.test(text),
    completedAndBlockedRetained:
      stage !== 'session_todos' ||
      (/complete|present|verified|receipt|\[x\]/i.test(
        taskContext('Harbour title'),
      ) &&
        /blocked|missing|unavailable|no source/i.test(
          taskContext('Music bed'),
        )),
    independentAssessment:
      stage !== 'completion_check' ||
      (/candidate|offer|claim/i.test(text) &&
        /does not|incomplete|unfinished|not fulfill|not satisf/i.test(text) &&
        /evidence|receipt|current state/i.test(text)),
    noInventedRequirements:
      !/Voiceover\s+(?:is\s+)?(?:required|mandatory)|Voiceover\s+must(?!\s+not)|must\s+(?:add\s+)?(?:a\s+)?Voiceover/i.test(
        text,
      ),
    noRoutineApprovalGate:
      stage !== 'session_todos' ||
      !/(?:blocked until|waiting for|requires|approval pending).{0,80}(?:say|explicit).{0,25}["'“]?go\b/i.test(
        text,
      ),
  };
}
