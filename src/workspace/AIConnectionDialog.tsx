import { useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction, ReactNode } from 'react';
import type { ProviderProfile } from './provider-preferences';
import {
  ChartNoAxesColumn,
  KeyRound,
  LoaderCircle,
  Trash2,
} from 'lucide-react';
import type { ContextPolicy, OpenRouterModel } from '../ai';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { CollapsibleDisclosure } from '../components/ui/collapsible';
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
import { useIndexConsent, saveIndexConsent } from './index-consent';
import { toast } from 'sonner';
import { ProviderSettings } from './ProviderSettings';
import type { ProviderSettingsProps } from './ProviderSettings';
interface Props extends Omit<
  ProviderSettingsProps,
  | 'connecting'
  | 'openRouterControls'
  | 'models'
  | 'model'
  | 'setModel'
  | 'refreshCatalog'
> {
  returnFocus?: () => HTMLElement | null;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  connecting: boolean;
  authorize: (id: string) => Promise<void>;
  connect: (kind: 'key', credential: string, id: string) => Promise<void>;
  model: string;
  setModel: (value: string) => void;
  models: OpenRouterModel[];
  refreshCatalog: () => Promise<void>;
  privacy: Required<ContextPolicy>;
  setPrivacy: Dispatch<SetStateAction<Required<ContextPolicy>>>;
  connectionError: string | null;
}
export default function AIConnectionDialog({
  returnFocus,
  settingsOpen,
  setSettingsOpen,
  connecting,
  authorize,
  connect,
  model,
  setModel,
  models,
  refreshCatalog,
  privacy,
  setPrivacy,
  connectionError,
  ...providerProps
}: Props) {
  const indexingAllowed = useIndexConsent();
  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={(open) => {
        setSettingsOpen(open);
      }}
    >
      <DialogContent
        finalFocus={
          returnFocus ??
          (() => document.getElementById('workspace-settings-trigger'))
        }
        className="ai-settings-dialog flex max-h-[calc(var(--app-viewport-height)*0.9)] flex-col gap-6 overflow-hidden p-6 sm:max-w-3xl sm:p-8"
      >
        <DialogHeader>
          <DialogTitle>AI connection</DialogTitle>
          <DialogDescription className="sr-only">
            Configure providers, service routes and models.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto pr-2">
          {connecting && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <LoaderCircle
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
              Connecting provider…
            </p>
          )}
          {connectionError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {connectionError}
              </p>
            </div>
          )}
          <ProviderSettings
            {...providerProps}
            connecting={connecting}
            models={models}
            model={model}
            setModel={setModel}
            refreshCatalog={refreshCatalog}
            openRouterControls={(profile, management) => (
              <OpenRouterConnection
                key={profile.id}
                profile={profile}
                management={management}
                connected={providerProps.connectedProviders.includes(
                  profile.id,
                )}
                connecting={connecting}
                authorize={authorize}
                connect={connect}
                remove={providerProps.removeProvider}
              />
            )}
          />
          <div className="space-y-2 border-t pt-6">
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
        </div>
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
                Optional project context for configured LLM providers.
              </PopoverDescription>
              <fieldset
                className="mt-4 space-y-3"
                disabled={models.length === 0}
              >
                <legend className="sr-only">
                  Project context shared with configured LLM providers
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
                      disabled={models.length === 0}
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

function OpenRouterConnection({
  profile,
  management,
  connected,
  connecting,
  authorize,
  connect,
  remove,
}: {
  profile: ProviderProfile;
  management: ReactNode;
  connected: boolean;
  connecting: boolean;
  authorize: Props['authorize'];
  connect: Props['connect'];
  remove: (id: string) => void;
}) {
  const [apiKey, setApiKey] = useState('');
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">{profile.name}</p>
        <div className="flex items-center gap-2">
          {!connected && (
            <Button
              disabled={connecting}
              onClick={() => {
                setApiKey('');
                void authorize(profile.id);
              }}
            >
              Connect with OpenRouter
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={connecting}
            aria-label={`Remove ${profile.name}`}
            title={`Remove ${profile.name}`}
            onClick={() => {
              setApiKey('');
              remove(profile.id);
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      {management}
      {!connected && (
        <CollapsibleDisclosure summary="Use an API key instead" defaultOpen>
          <form
            className="space-y-3 pt-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              const key = apiKey;
              setApiKey('');
              void connect('key', key, profile.id);
            }}
          >
            <Label htmlFor={`key-${profile.id}`}>{profile.name} API key</Label>
            <Input
              id={`key-${profile.id}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              disabled={connecting}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={connecting || !apiKey.trim()}
            >
              <KeyRound aria-hidden="true" />
              Use API key
            </Button>
          </form>
        </CollapsibleDisclosure>
      )}
    </div>
  );
}
