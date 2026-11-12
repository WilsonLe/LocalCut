import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { formatTime } from './helpers';

export type TranscriptCueDraft = {
  id: string;
  start: string;
  end: string;
  text: string;
};

export function TranscriptTimeline({
  cues,
  readOnly,
  disabled,
  onChange,
  onSeek,
}: {
  cues: TranscriptCueDraft[];
  readOnly: boolean;
  disabled: boolean;
  onChange(cues: TranscriptCueDraft[]): void;
  onSeek(timeUs: number): void;
}) {
  const [editingId, setEditingId] = useState<string | undefined>(() =>
    cues.length === 1 && !cues[0]!.text && !readOnly ? cues[0]!.id : undefined,
  );
  const [selectedId, setSelectedId] = useState<string>();
  const restoreFocus = useRef<string | undefined>(undefined);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editingId || !restoreFocus.current) return;
    (
      editButtons.current.get(restoreFocus.current) ?? addButton.current
    )?.focus();
    restoreFocus.current = undefined;
  }, [editingId]);
  const update = (id: string, patch: Partial<TranscriptCueDraft>) =>
    onChange(cues.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)));
  const finish = (id: string) => {
    restoreFocus.current = id;
    setEditingId(undefined);
  };
  return (
    <section aria-label="Transcript timeline">
      <ol>
        {cues.map((cue, index) => {
          const editing = editingId === cue.id && !readOnly;
          const timed =
            !!cue.start.trim() && Number.isFinite(Number(cue.start));
          const selected = selectedId === cue.id || editing;
          return (
            <li
              key={cue.id}
              className="group grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[5.25rem_minmax(0,1fr)]"
            >
              <div className="pt-0.5 text-right">
                {timed ? (
                  <button
                    type="button"
                    className={`rounded px-1 py-1.5 font-mono text-xs tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'text-primary' : 'text-muted-foreground'}`}
                    aria-label={`Preview transcript at ${formatTime(Number(cue.start) * 1e6)}`}
                    onClick={() => {
                      setSelectedId(cue.id);
                      onSeek(Math.round(Number(cue.start) * 1e6));
                    }}
                  >
                    {formatTime(Number(cue.start) * 1e6)}
                  </button>
                ) : (
                  <span className="inline-block px-1 py-1.5 text-xs text-muted-foreground">
                    —
                  </span>
                )}
              </div>
              <div className="relative min-w-0 border-l border-border pb-4 pl-4 group-last:border-transparent sm:pl-5">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[4.5px] top-3 size-2 rounded-full border-2 border-background ${selected ? 'bg-primary ring-2 ring-primary/20' : 'bg-muted-foreground/50'}`}
                />
                {editing ? (
                  <div className="space-y-1">
                    <Textarea
                      aria-label={
                        index === 0
                          ? 'Transcript'
                          : `Transcript text ${index + 1}`
                      }
                      className="min-h-16 w-full resize-y text-sm leading-6"
                      rows={Math.max(2, cue.text.split('\n').length)}
                      value={cue.text}
                      maxLength={1000000}
                      disabled={disabled}
                      autoFocus
                      onChange={(event) =>
                        update(cue.id, { text: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter' &&
                          (event.ctrlKey || event.metaKey)
                        ) {
                          event.preventDefault();
                          finish(cue.id);
                        }
                      }}
                    />
                    <div className="flex items-center gap-1">
                      <Popover>
                        <PopoverTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                            />
                          }
                          aria-label={`Edit transcript timing ${index + 1}`}
                          title="Timing"
                          disabled={disabled}
                        >
                          <Clock3 />
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-60"
                          aria-label={`Transcript timing ${index + 1}`}
                        >
                          <div className="grid grid-cols-2 gap-3">
                            <label className="grid gap-1 text-xs text-muted-foreground">
                              Start (s)
                              <Input
                                aria-label={`Transcript start ${index + 1} (s)`}
                                type="number"
                                step="0.001"
                                min="0"
                                placeholder="Untimed"
                                value={cue.start}
                                disabled={disabled}
                                onChange={(event) =>
                                  update(cue.id, { start: event.target.value })
                                }
                              />
                            </label>
                            <label className="grid gap-1 text-xs text-muted-foreground">
                              End (s)
                              <Input
                                aria-label={`Transcript end ${index + 1} (s)`}
                                type="number"
                                step="0.001"
                                min="0"
                                value={cue.end}
                                disabled={disabled}
                                onChange={(event) =>
                                  update(cue.id, { end: event.target.value })
                                }
                              />
                            </label>
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove transcript text ${index + 1}`}
                        title="Remove text"
                        disabled={disabled}
                        onClick={() => {
                          onChange(cues.filter((item) => item.id !== cue.id));
                          restoreFocus.current =
                            cues[index + 1]?.id ??
                            cues[index - 1]?.id ??
                            cue.id;
                          setEditingId(undefined);
                        }}
                      >
                        <Trash2 />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
                        aria-label={`Finish editing transcript text ${index + 1}`}
                        title="Done"
                        disabled={disabled}
                        onClick={() => finish(cue.id)}
                      >
                        <Check />
                      </Button>
                    </div>
                  </div>
                ) : readOnly ? (
                  <p className="whitespace-pre-wrap break-words py-1.5 text-sm leading-6">
                    {cue.text}
                  </p>
                ) : (
                  <button
                    ref={(element) => {
                      if (element) editButtons.current.set(cue.id, element);
                      else editButtons.current.delete(cue.id);
                    }}
                    type="button"
                    aria-label={`Edit transcript text ${index + 1}`}
                    disabled={disabled}
                    onClick={() => setEditingId(cue.id)}
                    className="flex min-h-9 w-full items-start gap-2 rounded-sm py-1.5 text-left text-sm leading-6 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                      {cue.text}
                    </span>
                    <Pencil className="mt-1 size-3.5 shrink-0 text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <div className="pl-[5.25rem] sm:pl-[5.75rem]">
          <Button
            ref={addButton}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Add transcript text"
            title="Add text"
            disabled={disabled}
            onClick={() => {
              const id = crypto.randomUUID();
              onChange([...cues, { id, start: '', end: '', text: '' }]);
              setEditingId(id);
            }}
          >
            <Plus />
          </Button>
        </div>
      )}
    </section>
  );
}
