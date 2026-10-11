import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import type { ErrorReport } from './error-toast';

export default function ErrorDetailsDialog({
  report,
  onClose,
}: {
  report: ErrorReport;
  onClose(): void;
}) {
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(true);
  const request = useRef(0);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = async () => {
    const token = ++request.current;
    setFailure('');
    try {
      await navigator.clipboard.writeText(report.text);
      if (!active.current || token !== request.current) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (active.current && token === request.current) {
        setCopied(false);
        setFailure(
          'Could not copy. Select the report text to copy it, or try again.',
        );
      }
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        finalFocus={() =>
          returnFocus.current?.isConnected
            ? returnFocus.current
            : document.getElementById('workspace-notifications-trigger')
        }
        className="flex flex-col gap-4 sm:max-w-3xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Error details</DialogTitle>
          <DialogDescription>{report.summary}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Stack trace and session data
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? 'Copied error details' : 'Copy error details'}
            title={copied ? 'Copied' : 'Copy error details'}
            onClick={() => void copy()}
          >
            {copied ? <Check data-copy-feedback="copied" /> : <Copy />}
          </Button>
          <span role="status" className="sr-only">
            {copied ? 'Error details copied' : ''}
          </span>
        </div>
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        <pre
          tabIndex={0}
          aria-label="Full error report"
          className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere select-text"
        >
          {report.text}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
