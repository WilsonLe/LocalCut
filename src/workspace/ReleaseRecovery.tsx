import { Component, createRef, type ReactNode } from 'react';
import { Button } from '../components/ui/button';

const reloadMarker = '_localcut_reload';

export function clearReloadMarker() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(reloadMarker)) return;
  url.searchParams.delete(reloadMarker);
  window.history.replaceState(window.history.state, '', url.href);
}

export function reloadWorkspace() {
  const url = new URL(window.location.href);
  // A fresh HTML URL also bypasses an intermediary's cached old app shell.
  url.searchParams.set(reloadMarker, crypto.randomUUID());
  for (const secret of ['code', 'state', 'error', 'error_description'])
    url.searchParams.delete(secret);
  window.location.replace(url.href);
}

/** Eager recovery stays usable even when an optional UI chunk is unavailable. */
export class ReleaseRecovery extends Component<
  { children: ReactNode },
  { failed: boolean; recover: boolean }
> {
  state = { failed: false, recover: false };
  private reload = createRef<HTMLButtonElement>();
  private previousFocus: HTMLElement | null = null;

  static getDerivedStateFromError() {
    return { failed: true, recover: true };
  }

  private onLoadError = () => {
    if (!this.state.recover) {
      this.previousFocus = document.activeElement as HTMLElement | null;
      this.setState({ recover: true });
    }
    // Let owning API catches and the React boundary settle their failed work.
    // Suppressing the rejection could pass an undefined module to consumers.
  };

  componentDidMount() {
    window.addEventListener('vite:preloadError', this.onLoadError);
  }

  componentWillUnmount() {
    window.removeEventListener('vite:preloadError', this.onLoadError);
  }

  componentDidUpdate(
    _props: { children: ReactNode },
    previous: { failed: boolean; recover: boolean },
  ) {
    if (this.state.recover && !previous.recover) this.reload.current?.focus();
  }

  render() {
    return (
      <>
        {!this.state.failed && this.props.children}
        {this.state.recover && (
          <section
            role="alert"
            aria-label="Workspace recovery"
            className="fixed right-4 bottom-4 left-4 z-[100] mx-auto max-w-lg rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
          >
            <p className="font-medium">
              {this.state.failed
                ? 'LocalCut could not open this screen.'
                : 'Part of LocalCut could not load.'}
            </p>
            <p className="mt-2 text-sm">
              Reload to get the current version. Saved projects stay on this
              device. Finish any active work before reloading.
            </p>
            <div className="mt-3 flex gap-2">
              <Button ref={this.reload} onClick={reloadWorkspace}>
                Reload LocalCut
              </Button>
              {!this.state.failed && (
                <Button
                  variant="outline"
                  onClick={() => {
                    this.setState({ recover: false });
                    this.previousFocus?.focus();
                  }}
                >
                  Dismiss
                </Button>
              )}
            </div>
          </section>
        )}
      </>
    );
  }
}
