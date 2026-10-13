import { useEffect, useRef, useState } from 'react';
import { Search, Pencil, Archive, RotateCcw, Check, X } from 'lucide-react';
import type { SpeechModel } from '../ai';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tooltip } from '../components/ui/tooltip';
import { speechVoiceLabel } from './speech-form';
import { voiceTimingLabel } from './voice-presets';
import type { VoicePreset } from './voice-presets';

export function VoicePresetManager({
  presets,
  selectedId,
  models,
  onSelect,
  onRename,
  onArchive,
}: {
  presets: VoicePreset[];
  selectedId: string;
  models: SpeechModel[];
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => boolean;
  onArchive: (preset: VoicePreset) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const archiveButtons = useRef(new Map<string, HTMLButtonElement>());
  const listToggle = useRef<HTMLButtonElement>(null);
  const pendingArchiveFocus = useRef<{ id?: string } | null>(null);
  const previousEditing = useRef('');
  useEffect(() => {
    const pending = pendingArchiveFocus.current;
    if (pending) {
      pendingArchiveFocus.current = null;
      (
        archiveButtons.current.get(pending.id ?? '') ?? listToggle.current
      )?.focus();
    } else if (!editing && previousEditing.current) {
      (
        renameButtons.current.get(previousEditing.current) ?? listToggle.current
      )?.focus();
    }
    previousEditing.current = editing;
  }, [editing, presets]);
  const visible = presets.filter(
    (item) =>
      item.archived === archived &&
      `${item.name} ${item.model} ${item.voice} ${item.languages.join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <details className="group space-y-3">
      <summary className="cursor-pointer text-sm font-medium">
        Manage voice presets{' '}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          ({presets.filter((item) => !item.archived).length})
        </span>
      </summary>
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              aria-label="Search managed voices"
              placeholder="Search voices…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant={archived ? 'secondary' : 'ghost'}
            ref={listToggle}
            aria-pressed={archived}
            onClick={() => {
              setArchived(!archived);
              setEditing('');
            }}
          >
            {archived ? 'Show active' : 'Show archived'}
          </Button>
        </div>
        <div
          className="max-h-56 space-y-1 overflow-y-auto"
          aria-label={
            archived ? 'Archived voice presets' : 'Active voice presets'
          }
        >
          {visible.length === 0 && (
            <p className="p-3 text-center text-sm text-muted-foreground">
              {query
                ? 'No matching voices.'
                : archived
                  ? 'No archived voices.'
                  : 'Save a configuration to reuse it here.'}
            </p>
          )}
          {visible.map((item) => (
            <div
              key={item.id}
              className={`flex flex-wrap items-center gap-2 rounded-md p-2 ${item.id === selectedId ? 'bg-accent' : 'hover:bg-muted/50'}`}
            >
              {editing === item.id ? (
                <form
                  className="flex w-full items-center gap-1"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditing('');
                    }
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (name.trim() && onRename(item.id, name.trim())) {
                      setEditing('');
                    }
                  }}
                >
                  <Input
                    autoFocus
                    className="min-w-0 flex-1"
                    aria-label={`Rename ${item.name}`}
                    maxLength={100}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Tooltip content="Save name">
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon-sm"
                      disabled={!name.trim()}
                      aria-label={`Save name for ${item.name}`}
                    >
                      <Check />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Cancel rename">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Cancel rename"
                      onClick={() => setEditing('')}
                    >
                      <X />
                    </Button>
                  </Tooltip>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={item.archived}
                    aria-label={`Use ${item.name}`}
                    aria-pressed={item.id === selectedId}
                    className="min-w-0 flex-1 basis-32 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    onClick={() => onSelect(item.id)}
                  >
                    <span className="block truncate text-sm font-medium">
                      {item.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {models.find((model) => model.id === item.model)?.name ??
                        item.model}{' '}
                      ·{' '}
                      {item.referenceId
                        ? 'Speaker reference'
                        : speechVoiceLabel(item.model, item.voice)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {voiceTimingLabel(item.timing)}
                      {item.languages.length
                        ? ` · ${item.languages.join(', ')}`
                        : ''}
                    </span>
                  </button>
                  <Tooltip content="Rename">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      ref={(element) => {
                        if (element)
                          renameButtons.current.set(item.id, element);
                        else renameButtons.current.delete(item.id);
                      }}
                      aria-label={`Edit name for ${item.name}`}
                      onClick={() => {
                        setEditing(item.id);
                        setName(item.name);
                      }}
                    >
                      <Pencil />
                    </Button>
                  </Tooltip>
                  <Tooltip content={item.archived ? 'Restore' : 'Archive'}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${item.archived ? 'Restore' : 'Archive'} ${item.name}`}
                      ref={(element) => {
                        if (element)
                          archiveButtons.current.set(item.id, element);
                        else archiveButtons.current.delete(item.id);
                      }}
                      onClick={() => {
                        const index = visible.findIndex(
                          (preset) => preset.id === item.id,
                        );
                        pendingArchiveFocus.current = {
                          id: visible[index + 1]?.id ?? visible[index - 1]?.id,
                        };
                        if (!onArchive(item))
                          pendingArchiveFocus.current = null;
                      }}
                    >
                      {item.archived ? <RotateCcw /> : <Archive />}
                    </Button>
                  </Tooltip>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
