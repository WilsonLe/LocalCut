import { afterEach, expect, it, vi } from 'vitest';
import { Autosave } from '../../src/services/autosave';
afterEach(() => vi.useRealTimers());
it('autosave waits one second after the last change and separates projects', async () => {
  vi.useFakeTimers();
  const save = vi.fn(async () => {}),
    failure = vi.fn();
  const autosave = new Autosave(save, failure);
  autosave.schedule('a');
  await vi.advanceTimersByTimeAsync(700);
  autosave.schedule('a');
  autosave.schedule('b');
  await vi.advanceTimersByTimeAsync(999);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save.mock.calls).toEqual([['a'], ['b']]);
  expect(failure).not.toHaveBeenCalled();
});
it('flush preserves edits arriving during an in-flight save and cancels pending timers', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = vi
    .fn()
    .mockImplementationOnce(() => pending)
    .mockResolvedValue(undefined);
  const autosave = new Autosave(save, vi.fn());
  autosave.schedule('a');
  await vi.advanceTimersByTimeAsync(1000);
  autosave.schedule('a');
  const flushing = autosave.flushAll();
  expect(save).toHaveBeenCalledTimes(1);
  release();
  await flushing;
  expect(save).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(save).toHaveBeenCalledTimes(2);
});
it('save failures are observable and an explicit retry can save the project', async () => {
  vi.useFakeTimers();
  const error = new Error('quota');
  const save = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValue(undefined);
  const failure = vi.fn();
  const autosave = new Autosave(save, failure);
  autosave.schedule('a');
  await vi.advanceTimersByTimeAsync(1000);
  expect(failure).toHaveBeenCalledWith('a', error);
  await autosave.flush('a');
  expect(save).toHaveBeenCalledTimes(2);
});
