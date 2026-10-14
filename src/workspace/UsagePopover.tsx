import { ChartNoAxesColumn, ChevronRight, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverClose,
  PopoverTitle,
  PopoverTrigger,
} from '../components/ui/popover';
import { Tooltip } from '../components/ui/tooltip';
import { requestUsage, summarizeUsage, usageLabels } from '../ai/usage';
import type { UsageMessage, UsageCall } from '../ai/usage';

const count = (value?: number) =>
  value === undefined ? 'Unavailable' : value.toLocaleString();
const money = (value?: number) =>
  value === undefined ? 'Unavailable' : `$${value.toFixed(6)}`;
function UsageTable({ calls }: { calls: UsageCall[] }) {
  const summary = summarizeUsage(calls);
  return (
    <div className="text-xs tabular-nums">
      <div className="flex justify-between gap-2 py-1">
        <span>Cache hit rate</span>
        <span>
          {summary.cacheHitRate === undefined
            ? 'Unavailable'
            : `${(summary.cacheHitRate * 100).toFixed(2)}%`}
        </span>
      </div>
      <table className="w-full">
        <caption className="sr-only">
          Token counts and estimated costs in USD
        </caption>
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-left font-normal">Tokens</th>
            <th className="text-right font-normal">Count</th>
            <th className="text-right font-normal">Est. USD</th>
          </tr>
        </thead>
        <tbody>
          {summary.categories
            .filter((row) => row.label !== 'Cache write' || row.tokens !== 0)
            .map((row) => (
              <tr key={row.label}>
                <th className="py-1 text-left font-normal">{row.label}</th>
                <td className="text-right">{count(row.tokens)}</td>
                <td className="text-right">{money(row.cost)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
function RequestUsagePopover({
  request,
}: {
  request: ReturnType<typeof requestUsage>[number];
}) {
  const summary = summarizeUsage(request.calls);
  const label = request.prompt || 'Message unavailable';
  return (
    <Popover>
      <Tooltip
        content={
          <span
            tabIndex={0}
            className="block max-h-[50vh] overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {label}
          </span>
        }
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-1 py-2 text-xs"
              data-usage-request={request.id}
            />
          }
        >
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <span className="shrink-0 tabular-nums">
            {money(summary.cost)}
            {summary.partial ? ' (partial)' : ''}
          </span>
          <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="left"
        align="start"
        className="w-96 space-y-3"
        aria-label="Message usage"
      >
        <div className="sticky -top-4 z-10 -mx-4 -mt-4 flex items-center justify-between gap-2 border-b bg-popover px-4 pt-4 pb-2">
          <PopoverTitle className="font-medium">Message usage</PopoverTitle>
          <PopoverClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close message usage"
              />
            }
          >
            <X aria-hidden="true" />
          </PopoverClose>
        </div>
        <p
          tabIndex={0}
          aria-label="Original message"
          className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs [overflow-wrap:anywhere]"
        >
          {label}
        </p>
        <div>
          <div className="flex justify-between gap-2 text-sm">
            <span>Message total{summary.partial ? ' (partial)' : ''}</span>
            <strong className="tabular-nums">{money(summary.cost)}</strong>
          </div>
          <UsageTable calls={request.calls} />
        </div>
        <div className="space-y-3 border-t pt-3" aria-label="Agent usage">
          {Object.entries(usageLabels).map(([source, agentLabel]) => {
            const agentCalls = summary.calls.filter(
              (call) => call.source === source,
            );
            if (!agentCalls.length) return null;
            const agent = summarizeUsage(agentCalls);
            return (
              <section key={source} aria-label={agentLabel}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <h3 className="font-medium">
                    {agentLabel} · {agentCalls.length}{' '}
                    {agentCalls.length === 1 ? 'call' : 'calls'}
                  </h3>
                  <span className="shrink-0 tabular-nums">
                    {money(agent.cost)}
                    {agent.partial ? ' (partial)' : ''}
                  </span>
                </div>
                <UsageTable calls={agentCalls} />
                <p className="break-words pt-1 text-xs text-muted-foreground">
                  {[...new Set(agentCalls.map((call) => call.model))].join(
                    ', ',
                  ) || 'Historical model unavailable'}
                </p>
              </section>
            );
          })}
          {!summary.calls.length && (
            <p className="text-xs text-muted-foreground">
              Usage has not been reported.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
export default function UsagePopover({
  messages,
}: {
  messages: UsageMessage[];
}) {
  const requests = requestUsage(messages);
  const calls = requests.flatMap((request) => request.calls);
  const total = summarizeUsage(calls);
  const latestMain = [...calls]
    .reverse()
    .find((call) => call.source === 'main');
  const prompt = latestMain?.usage?.promptTokens;
  const limit = latestMain?.contextLength;
  return (
    <Popover>
      <Tooltip content="Context and costs">
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Context and costs"
            />
          }
        >
          <ChartNoAxesColumn aria-hidden="true" />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        className="w-96 space-y-3"
        aria-label="Context and costs"
      >
        <div className="flex items-baseline justify-between gap-2">
          <PopoverTitle className="font-medium">Context and costs</PopoverTitle>
          <span className="text-xs text-muted-foreground">USD</span>
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <span>Last main context</span>
            <span className="tabular-nums">
              {count(prompt)}
              {limit
                ? ` / ${count(limit)}${prompt !== undefined ? ` · ${((prompt / limit) * 100).toFixed(1)}%` : ''}`
                : ''}
            </span>
          </div>
          {prompt !== undefined && limit !== undefined && (
            <meter
              className="h-2 w-full"
              min={0}
              max={limit}
              value={Math.min(prompt, limit)}
              aria-label="Last main context usage"
            />
          )}
        </div>
        <div className="border-t pt-3">
          <div className="flex justify-between gap-2 text-sm">
            <span>Chat total{total.partial ? ' (partial)' : ''}</span>
            <strong className="tabular-nums">{money(total.cost)}</strong>
          </div>
          <UsageTable calls={calls} />
        </div>
        <div className="space-y-2 border-t pt-2" aria-label="Usage by request">
          {!requests.length && (
            <p className="text-xs text-muted-foreground">
              Send a request to see usage.
            </p>
          )}
          {[...requests].reverse().map((request) => (
            <RequestUsagePopover key={request.id} request={request} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
