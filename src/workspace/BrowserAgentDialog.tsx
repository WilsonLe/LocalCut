import { useSyncExternalStore } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import { browserAgentConnection, connectionLabel } from './webmcp/connection';

export default function BrowserAgentDialog({ onClose }: { onClose(): void }) {
  const state = useSyncExternalStore(
    browserAgentConnection.subscribe,
    browserAgentConnection.getSnapshot,
  );
  const scopes = Object.values(state.scopes);
  const refreshing = scopes.some((scope) => scope.phase === 'registering');
  const ready =
    scopes.length > 0 && scopes.every((scope) => scope.phase === 'ready');
  const count = scopes.reduce((total, scope) => total + scope.count, 0);
  const Icon = refreshing ? LoaderCircle : ready ? CheckCircle2 : CircleAlert;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        finalFocus={() => document.getElementById('workspace-settings-trigger')}
      >
        <DialogHeader>
          <DialogTitle>Browser agent</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <Icon
            className={`size-5 shrink-0 ${refreshing ? 'animate-spin' : 'text-muted-foreground'}`}
          />
          <div>
            <p role="status" className="text-sm font-medium">
              {connectionLabel(state)}
            </p>
            {ready && (
              <p className="text-sm text-muted-foreground">
                {count} tools available
              </p>
            )}
          </div>
        </div>
        <dl className="flex items-center justify-between gap-4 text-sm">
          <dt className="text-muted-foreground">Last request</dt>
          <dd>
            {state.lastRequest === null ? (
              'No requests yet'
            ) : (
              <time dateTime={new Date(state.lastRequest).toISOString()}>
                {new Date(state.lastRequest).toLocaleTimeString()}
              </time>
            )}
          </dd>
        </dl>
        {[
          ...new Set(
            scopes.flatMap((scope) => (scope.error ? [scope.error] : [])),
          ),
        ].map((error) => (
          <p
            key={error}
            role="alert"
            className="break-words text-sm text-destructive"
          >
            {error}
          </p>
        ))}
        <details open={!ready} className="text-sm">
          <summary className="cursor-pointer font-medium">
            Connect or reconnect
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>Open LocalCut in your agent’s browser.</li>
            <li>
              Enable site tools in the browser’s permissions. In ChatGPT
              desktop: Settings → Browser → Permissions → Enable site tools.
            </li>
            <li>
              In the address bar, open Site tools → Available site tools. Check
              that LocalCut’s tools appear.
            </li>
            <li>Refresh here, then ask your agent to inspect the project.</li>
          </ol>
          <p className="mt-3 text-muted-foreground">
            LocalCut can refresh its tools. Browser permissions and agent access
            are controlled by your browser. Tools ready does not confirm an
            agent connection.
          </p>
          <a
            href="https://learn.chatgpt.com/docs/webmcp"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block underline underline-offset-4"
          >
            Browser setup guide
          </a>
        </details>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={() => {
              void browserAgentConnection.refresh();
            }}
            aria-label="Refresh browser agent tools"
          >
            <RefreshCw />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
