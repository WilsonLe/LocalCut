import type { Dispatch, FormEvent, SetStateAction } from 'react';
import {
  Check,
  ChartNoAxesColumn,
  KeyRound,
  LoaderCircle,
  Unplug,
} from 'lucide-react';
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '../components/ui/popover';
import { ModelPicker } from './ModelPicker';
import { useIndexConsent, saveIndexConsent } from './index-consent';
import { toast } from 'sonner';
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
  model: string;
  setModel: (value: string) => void;
  models: OpenRouterModel[];
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
  model,
  setModel,
  models,
  refreshCatalog,
  privacy,
  setPrivacy,
  connectionError,
}: Props) {
  const indexingAllowed = useIndexConsent();
  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={(open) => {
        setSettingsOpen(open);
        if (!open) setApiKey('');
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>AI connection</DialogTitle>
          <DialogDescription className="sr-only">
            Configure OpenRouter and choose a model.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="asset-index-consent"
              checked={indexingAllowed}
              onCheckedChange={(checked) => {
                if (!saveIndexConsent(checked === true))
                  toast.error(
                    'Indexing permission could not be saved. This choice lasts for this session.',
                  );
              }}
            />
            <Label htmlFor="asset-index-consent">Allow asset indexing</Label>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Index sends locally generated images, audio excerpts and video
            excerpts with sound to OpenRouter. Saved labels can be shared with
            Klip in chat. Remembered on this device; revoke here anytime.
          </p>
        </div>
        {!connection ? (
          <div className="space-y-5">
            {connecting && (
              <p role="status" className="flex items-center gap-2 text-sm">
                <LoaderCircle
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
                Connecting OpenRouter…
              </p>
            )}
            <Button
              className="w-full"
              disabled={connecting}
              onClick={() => void authorize()}
            >
              Connect with OpenRouter
            </Button>
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                const key = apiKey;
                setApiKey('');
                void connect('key', key);
              }}
              className="space-y-3"
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
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={connecting || !apiKey.trim()}
              >
                <KeyRound aria-hidden="true" />
                Use API key
              </Button>
            </form>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Check className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium">OpenRouter</p>
                  <p role="status" className="text-xs text-muted-foreground">
                    Key connected
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={disconnect}>
                <Unplug aria-hidden="true" />
                Disconnect
              </Button>
            </div>
            <div className="space-y-2">
              <Label>AI model</Label>
              <ModelPicker
                models={models}
                model={model}
                onChange={setModel}
                loading={connecting}
                refresh={refreshCatalog}
              />
            </div>
          </div>
        )}
        {connectionError && (
          <p role="alert" className="text-sm text-destructive">
            {connectionError}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Data & analytics"
                  title="Data & analytics"
                />
              }
            >
              <ChartNoAxesColumn aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent aria-label="Data & analytics">
              <PopoverTitle className="font-medium">
                Data & analytics
              </PopoverTitle>
              <PopoverDescription className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Optional project context for OpenRouter.
              </PopoverDescription>
              <fieldset className="mt-4 space-y-3" disabled={!connection}>
                <legend className="sr-only">
                  Project context shared with OpenRouter
                </legend>
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
                      disabled={!connection}
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
              </fieldset>
            </PopoverContent>
          </Popover>
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
