import { performance } from 'node:perf_hooks';
// One shared slot budget: no nested full-machine worker pools. Dependencies protect build outputs.
export async function schedule(tasks, slots) {
  const pending = [...tasks],
    active = new Map(),
    done = new Set();
  let used = 0,
    failure;
  while (pending.length || active.size) {
    if (!failure) {
      for (const task of [...pending]) {
        const cost = Math.min(slots, task.cost);
        if (
          used + cost > slots ||
          !(task.after ?? []).every((id) => done.has(id))
        )
          continue;
        pending.splice(pending.indexOf(task), 1);
        used += cost;
        const started = performance.now();
        console.log(`[check] ${task.id} started (${cost}/${slots} slots)`);
        const completion = Promise.resolve()
          .then(task.run)
          .then(
            () => ({ task, cost, started }),
            (error) => ({ task, cost, started, error }),
          );
        active.set(task.id, completion);
      }
    }
    if (!active.size) {
      if (failure) break;
      throw new Error('Test task graph has unresolved dependencies.');
    }
    const result = await Promise.race(active.values());
    active.delete(result.task.id);
    used -= result.cost;
    if (result.error) failure ??= result.error;
    else done.add(result.task.id);
    console.log(
      `[check] ${result.task.id} ${result.error ? 'failed' : 'passed'} in ${((performance.now() - result.started) / 1000).toFixed(1)}s`,
    );
  }
  if (failure) throw failure;
}
