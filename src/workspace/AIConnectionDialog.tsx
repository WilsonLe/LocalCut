import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { ContextPolicy, OpenRouterModel } from '../ai';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { SettingsSelect } from './SettingsSelect';
interface Props {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  connection: boolean;
  connecting: boolean;
  apiKey: string;
  setApiKey: (key: string) => void;
  authorize: () => Promise<void>;
  connect: (kind: 'key', credential: string) => Promise<void>;
  disconnect: () => void;
  search: string;
  setSearch: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  models: OpenRouterModel[];
  filtered: OpenRouterModel[];
  visibleModels: OpenRouterModel[];
  selectedModel: OpenRouterModel | undefined;
  refreshCatalog: () => Promise<void>;
  privacy: Required<ContextPolicy>;
  setPrivacy: Dispatch<SetStateAction<Required<ContextPolicy>>>;
  connectionError: string | null;
}
export default function AIConnectionDialog({
  settingsOpen,
  setSettingsOpen,
  connection,
  connecting,
  apiKey,
  setApiKey,
  authorize,
  connect,
  disconnect,
  search,
  setSearch,
  model,
  setModel,
  models,
  filtered,
  visibleModels,
  selectedModel,
  refreshCatalog,
  privacy,
  setPrivacy,
  connectionError,
}: Props) {
  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={(open) => {
        setSettingsOpen(open);
        if (!open) setApiKey('');
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI connection</DialogTitle>
          <DialogDescription>
            Your prompt and selected project metadata go to OpenRouter. Video,
            images, audio and local transcription stay on this device.
          </DialogDescription>
        </DialogHeader>
        {!connection ? (
          <div className="space-y-4">
            <Button
              className="w-full"
              disabled={connecting}
              onClick={() => void authorize()}
            >
              {connecting && (
                <LoaderCircle
                  className="motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              Connect with OpenRouter
            </Button>
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                const key = apiKey;
                setApiKey('');
                void connect('key', key);
              }}
              className="space-y-2"
            >
              <Label htmlFor="openrouter-key">OpenRouter API key</Label>
              <Input
                id="openrouter-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={connecting}
              />
              <p className="text-xs text-muted-foreground">
                Or use your own key. It stays in memory and is cleared when you
                disconnect or reload.
              </p>
              <Button
                type="submit"
                variant="outline"
                disabled={connecting || !apiKey.trim()}
              >
                Use API key
              </Button>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm">
                <Check className="size-4" aria-hidden="true" /> Key connected
              </span>
              <Button variant="ghost" size="sm" onClick={disconnect}>
                Disconnect
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-model-search">Search models</Label>
              <Input
                id="ai-model-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a model by name or ID"
              />
              <Label id="ai-model-label">AI model</Label>
              <SettingsSelect
                label="AI model"
                value={model || null}
                onChange={setModel}
                disabled={connecting || !models.length}
                placeholder="Choose a tool-capable model"
                selectedLabel={selectedModel?.name}
                options={visibleModels.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.id}`,
                }))}
              />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {connecting
                    ? 'Loading models…'
                    : !models.length
                      ? 'No models loaded.'
                      : filtered.length > 100
                        ? `${filtered.length} matches. Refine your search.`
                        : 'Only models with editing tools are shown.'}
                </span>
                <Button
                  variant="link"
                  size="xs"
                  disabled={connecting}
                  onClick={() => void refreshCatalog()}
                >
                  Refresh models
                </Button>
              </div>
            </div>
            <fieldset className="space-y-3 border-t pt-4">
              <legend className="sr-only">
                Project context shared with OpenRouter
              </legend>
              <p className="text-sm font-medium">Also share with OpenRouter</p>
              {(
                [
                  ['includeText', 'Share overlay and caption text'],
                  ['includeAssetNames', 'Share project and media names'],
                  ['includeTranscripts', 'Share source transcripts'],
                ] as const
              ).map(([key, label]) => (
                <div className="flex items-center gap-2" key={key}>
                  <Checkbox
                    id={`share-${key}`}
                    checked={privacy[key]}
                    onCheckedChange={(checked) =>
                      setPrivacy((value) => ({
                        ...value,
                        [key]: checked === true,
                      }))
                    }
                  />
                  <Label
                    htmlFor={`share-${key}`}
                    className="text-sm font-normal"
                  >
                    {label}
                  </Label>
                </div>
              ))}
              <p className="text-xs leading-relaxed text-muted-foreground">
                All options start off. Changing a model or sharing option starts
                a new conversation and cancels an unfinished response. Saved
                edits remain.
              </p>
            </fieldset>
          </div>
        )}
        {connectionError && (
          <p role="alert" className="text-sm text-destructive">
            {connectionError}
          </p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Provider charges may apply. Set spending limits in OpenRouter.
          LocalCut does not guarantee zero retention by OpenRouter.
        </p>
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setApiKey('');
              setSettingsOpen(false);
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
