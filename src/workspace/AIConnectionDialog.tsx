import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ProviderProfile } from './provider-preferences';
import { KeyRound, ArrowLeft, LoaderCircle, Info } from 'lucide-react';
import type { OpenRouterModel } from '../ai';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '../components/ui/popover';
import SelectField from './SelectField';
import { ProviderSettings } from './ProviderSettings';
import type { ProviderSettingsProps } from './ProviderSettings';
interface Props extends Omit<
  ProviderSettingsProps,
  | 'activeTab'
  | 'connecting'
  | 'openRouterControls'
  | 'models'
  | 'model'
  | 'setModel'
  | 'refreshCatalog'
> {
  initialTab?: ProviderSettingsProps['activeTab'];
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
  connectionError: string | null;
  retryCredentialRemoval?: () => void;
}
export default function AIConnectionDialog({
  returnFocus,
  initialTab = 'providers',
  settingsOpen,
  setSettingsOpen,
  connecting,
  authorize,
  connect,
  model,
  setModel,
  models,
  refreshCatalog,
  connectionError,
  retryCredentialRemoval,
  ...providerProps
}: Props) {
  const [activeTab, setActiveTab] =
    useState<ProviderSettingsProps['activeTab']>(initialTab);
  const [confirmation, setConfirmation] = useState(false);
  const sections = [
    { value: 'providers', label: 'OpenRouter' },
    { value: 'llm', label: 'LLM - Chat' },
    { value: 'tts', label: 'TTS - Speech' },
    { value: 'stt', label: 'STT - Transcription' },
  ];
  const account = providerProps.providerConfiguration.profiles[0];
  const connectionDialog = useRef<HTMLDivElement | null>(null);
  const confirmationOpener = useRef<HTMLElement | null>(null);
  const confirmDisconnect = () => {
    confirmationOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setConfirmation(true);
  };
  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={(open) => {
        setSettingsOpen(open);
      }}
    >
      <DialogContent
        ref={connectionDialog}
        finalFocus={
          returnFocus ??
          (() => document.getElementById('workspace-settings-trigger'))
        }
        className="ai-settings-dialog flex flex-col gap-6 overflow-hidden p-6 sm:max-w-3xl sm:p-8"
      >
        <DialogHeader className="pr-6">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <DialogTitle className="shrink-0">AI connection</DialogTitle>
            <div className="min-w-0 max-w-[55%]">
              <SelectField
                label="AI settings section"
                value={activeTab}
                selectedLabel={
                  sections.find((section) => section.value === activeTab)?.label
                }
                options={sections}
                onChange={(value) =>
                  setActiveTab(value as ProviderSettingsProps['activeTab'])
                }
              />
            </div>
          </div>
          <DialogDescription className="sr-only">
            Connect OpenRouter and choose chat, speech and transcription models.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto pr-2">
          {connecting && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <LoaderCircle
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
              Connecting OpenRouter…
            </p>
          )}
          {connectionError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {connectionError}
              </p>
              {retryCredentialRemoval && (
                <Button variant="outline" onClick={retryCredentialRemoval}>
                  Retry removing saved key
                </Button>
              )}
            </div>
          )}
          <ProviderSettings
            {...providerProps}
            activeTab={activeTab}
            disconnect={confirmDisconnect}
            connecting={connecting}
            models={models}
            model={model}
            setModel={setModel}
            refreshCatalog={refreshCatalog}
            openRouterControls={(profile, management) => (
              <OpenRouterConnection
                key={`${profile.id}:${providerProps.connected}`}
                profile={profile}
                management={management}
                connected={providerProps.connected}
                connecting={connecting}
                authorize={authorize}
                connect={connect}
              />
            )}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSettingsOpen(false);
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
      <Dialog
        open={!!confirmation && !!account}
        onOpenChange={(open) => {
          if (!open) setConfirmation(false);
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() => {
            if (!connectionDialog.current?.hasAttribute('data-open'))
              return false;
            return confirmationOpener.current?.isConnected
              ? confirmationOpener.current
              : connectionDialog.current.querySelector<HTMLElement>(
                  '[aria-label="AI settings section"]',
                );
          }}
        >
          <DialogHeader>
            <DialogTitle>Disconnect OpenRouter?</DialogTitle>
            <DialogDescription>
              Remove the saved OpenRouter key from this browser? You can connect
              again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              autoFocus
              onClick={() => setConfirmation(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={connecting}
              onClick={() => {
                if (!confirmation || !account) return;
                setConfirmation(false);
                providerProps.disconnect();
              }}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
}: {
  profile: ProviderProfile;
  management: ReactNode;
  connected: boolean;
  connecting: boolean;
  authorize: Props['authorize'];
  connect: Props['connect'];
}) {
  const [apiKey, setApiKey] = useState('');
  const [method, setMethod] = useState<'choice' | 'key'>('choice');
  const termsContent = useRef<HTMLDivElement | null>(null);
  return (
    <div
      role="group"
      aria-label={`${profile.name} connection`}
      className="space-y-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <p className="min-w-0 truncate text-sm font-medium">{profile.name}</p>
          <Popover>
            <PopoverTrigger
              openOnHover
              delay={200}
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${profile.name} connection terms`}
                />
              }
            >
              <Info aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent
              ref={termsContent}
              aria-label={`${profile.name} connection terms`}
              initialFocus={(type) =>
                type === 'keyboard' || type === 'touch'
                  ? termsContent.current
                  : false
              }
              className="max-h-[min(32rem,var(--available-height))] w-64 border-0 bg-foreground px-3 py-2 text-xs text-background shadow-md"
            >
              <section
                aria-label="OpenRouter connection terms"
                className="space-y-2 text-xs leading-relaxed select-text"
              >
                <h3 className="font-medium">Connection terms</h3>
                <p>
                  By connecting OpenRouter, you agree to share project and media
                  names, overlay, caption and storyboard text (including frame
                  names), source transcript text, and embedded capture dates and
                  GPS with your selected OpenRouter model when you send a
                  request. All these context categories stay enabled while
                  OpenRouter is connected, including after reload.
                </p>
                <p>
                  Explicit Index or a chat indexing request can also send
                  generated images, audio excerpts and video excerpts with sound
                  to your selected OpenRouter model. Saved index labels are
                  available in chat. AI requests may incur provider charges.
                  Connecting, importing and reloading do not start chat or
                  indexing requests. Original media files stay local; a
                  requested remote transcription job may send selected audio to
                  its disclosed recipients.
                </p>
                <p>
                  Your key is saved only in this browser and is excluded from
                  backups. Disconnect removes your saved key and ends sharing
                  authorization. Provider processing is governed by the{' '}
                  <a
                    className="underline underline-offset-4"
                    href="https://openrouter.ai/terms"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenRouter Terms of Service
                  </a>{' '}
                  and{' '}
                  <a
                    className="underline underline-offset-4"
                    href="https://openrouter.ai/privacy"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Privacy Policy
                  </a>
                  , along with your selected model providers’ policies.
                </p>
              </section>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2">{management}</div>
      </div>
      {!connected && (
        <div className="space-y-3">
          {method === 'choice' && (
            <p className="text-sm">Do you already have an API key?</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={method === 'choice' ? 'outline' : 'ghost'}
              disabled={connecting}
              onClick={() => {
                setApiKey('');
                setMethod(method === 'choice' ? 'key' : 'choice');
              }}
            >
              {method === 'choice' ? (
                <KeyRound aria-hidden="true" />
              ) : (
                <ArrowLeft aria-hidden="true" />
              )}
              {method === 'choice' ? 'I have an API key' : 'Back'}
            </Button>
            {method === 'choice' && (
              <Button
                disabled={connecting}
                onClick={() => {
                  setApiKey('');
                  void authorize(profile.id);
                }}
              >
                Log in and generate a key
              </Button>
            )}
          </div>
          {method === 'key' && (
            <form
              className="space-y-3 pt-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                const key = apiKey;
                setApiKey('');
                void connect('key', key, profile.id);
              }}
            >
              <Label htmlFor={`key-${profile.id}`}>
                {profile.name} API key
              </Label>
              <Input
                id={`key-${profile.id}`}
                type="password"
                autoFocus
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
          )}
        </div>
      )}
    </div>
  );
}
