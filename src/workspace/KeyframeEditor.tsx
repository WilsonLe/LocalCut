import { useState } from 'react';
import type { Clip, Parameter } from '../core/model';
import { evaluateKeys } from '../core/timing';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { SettingsSelect } from './SettingsSelect';

const fields: {
  value: Parameter;
  label: string;
  min?: number;
  max?: number;
}[] = [
  { value: 'x', label: 'Position X (pixels)' },
  { value: 'y', label: 'Position Y (pixels)' },
  { value: 'width', label: 'Width (pixels)', min: 0.000001 },
  { value: 'height', label: 'Height (pixels)', min: 0.000001 },
  { value: 'rotation', label: 'Rotation (degrees)' },
  { value: 'opacity', label: 'Opacity', min: 0, max: 1 },
  { value: 'gain', label: 'Gain', min: 0, max: 16 },
  { value: 'brightness', label: 'Brightness', min: 0, max: 4 },
  { value: 'contrast', label: 'Contrast', min: 0, max: 4 },
  { value: 'saturation', label: 'Saturation', min: 0, max: 4 },
  { value: 'grayscale', label: 'Grayscale', min: 0, max: 1 },
  { value: 'blur', label: 'Blur (pixels)', min: 0, max: 100 },
];

/** Draft curves belong to this form, never to the source asset or saved snapshot. */
export function KeyframeEditor({
  clip,
  keyframes,
  onChange,
  onBaseChange,
  onValidityChange,
  playheadUs,
  readOnly,
}: {
  clip: Clip;
  keyframes: Clip['keyframes'];
  onChange: (keys: Clip['keyframes']) => void;
  onBaseChange: (parameter: Parameter, value: number) => void;
  onValidityChange: (valid: boolean) => void;
  playheadUs: number;
  readOnly?: boolean;
}) {
  const available = fields.filter((field) =>
    clip.kind === 'audio'
      ? field.value === 'gain'
      : clip.kind === 'image' || clip.kind === 'video'
        ? field.value !== 'gain' || clip.kind === 'video'
        : ['x', 'y', 'width', 'height', 'rotation', 'opacity'].includes(
            field.value,
          ),
  );
  const [parameter, setParameter] = useState<Parameter>(available[0]!.value);
  const field = available.find((item) => item.value === parameter)!;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const validity = (next: typeof invalid) => {
    setInvalid(next);
    onValidityChange(Object.keys(next).length === 0);
  };
  const readNumber = (
    input: HTMLInputElement,
    id: string,
    label: string,
    time = false,
  ) => {
    const text = input.value;
    setDrafts((previous) => ({ ...previous, [id]: text }));
    const value = time
      ? Math.round(Number(input.value) * 1e6)
      : Number(input.value);
    const valid =
      input.validity.valid &&
      Number.isFinite(value) &&
      (!time || Number.isSafeInteger(value));
    const next = { ...invalid };
    if (valid) delete next[id];
    else next[id] = `${field.label}: ${label}`;
    validity(next);
    // Retain the last valid value for sampling while incomplete text belongs
    // to the form draft, including when another property is visible.
    return valid ? value : undefined;
  };
  const removeDrafts = (ids: string[]) => {
    validity(
      Object.fromEntries(
        Object.entries(invalid).filter(([id]) => !ids.includes(id)),
      ),
    );
    setDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([id]) => !ids.includes(id)),
      ),
    );
  };
  const keys = keyframes[parameter] ?? [];
  const localUs = Math.max(
    0,
    Math.min(clip.durationUs, playheadUs - clip.startUs),
  );
  const replace = (points: typeof keys) =>
    onChange({ ...keyframes, [parameter]: points });
  const add = (timeUs: number) => {
    if (keys.some((key) => key.timeUs === timeUs)) return;
    replace(
      [
        ...keys,
        {
          id: crypto.randomUUID(),
          timeUs,
          value: evaluateKeys(
            [...keys].sort((a, b) => a.timeUs - b.timeUs),
            timeUs,
            clip[parameter],
          ),
          interpolation: 'linear' as const,
        },
      ].sort((a, b) => a.timeUs - b.timeUs),
    );
  };
  const ordered = [...keys].sort((a, b) => a.timeUs - b.timeUs);
  const low = Math.min(clip[parameter], ...keys.map((key) => key.value));
  const high = Math.max(clip[parameter], ...keys.map((key) => key.value));
  const y = (value: number) =>
    high === low ? 50 : 90 - ((value - low) * 80) / (high - low);
  const x = (timeUs: number) => 10 + (timeUs * 300) / clip.durationUs;
  return (
    <div className="grid gap-3">
      <Label htmlFor="animation-property">Animated property</Label>
      <SettingsSelect
        id="animation-property"
        label="Animated property"
        value={parameter}
        selectedLabel={`${field.label}${keys.length ? ` · ${keys.length} points` : ''}`}
        onChange={(value) => setParameter(value as Parameter)}
        options={available.map((item) => ({
          value: item.value,
          label: `${item.label}${keyframes[item.value]?.length ? ` · ${keyframes[item.value]!.length} points` : ''}`,
        }))}
      />
      <p className="text-xs text-muted-foreground">
        Times are seconds from this clip’s start. Interpolation leads to the
        next point.
      </p>
      {parameter !== 'gain' && (
        <div className="grid gap-1">
          <Label htmlFor="animation-base">Base value</Label>
          <Input
            key={parameter}
            id="animation-base"
            type="number"
            required
            min={field.min}
            max={field.max}
            step="any"
            value={drafts[`base-${parameter}`] ?? String(clip[parameter])}
            readOnly={readOnly}
            onChange={(event) => {
              const value = readNumber(
                event.target,
                `base-${parameter}`,
                'base value',
              );
              if (value !== undefined) onBaseChange(parameter, value);
            }}
          />
        </div>
      )}
      <svg
        viewBox="0 0 320 100"
        className="h-24 w-full rounded-md border bg-muted/30"
        role="img"
        aria-label="Keyframe animation graph"
      >
        <path
          d={Array.from(
            { length: 161 },
            (_, i) =>
              `${i ? 'L' : 'M'} ${10 + (i * 300) / 160} ${y(evaluateKeys(ordered, (clip.durationUs * i) / 160, clip[parameter]))}`,
          ).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {keys.map((key) => (
          <circle
            key={key.id}
            cx={x(key.timeUs)}
            cy={y(key.value)}
            r="3"
            fill="currentColor"
          />
        ))}
        <path
          d={`M ${x(localUs)} 5 V 95`}
          stroke="currentColor"
          opacity="0.3"
        />
      </svg>
      {keys.map((key, index) => (
        <div
          key={`${parameter}:${key.id}`}
          className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_1.2fr_auto]"
        >
          <div className="grid gap-1">
            <Label htmlFor={`key-time-${key.id}`}>
              Point {index + 1} time (seconds)
            </Label>
            <Input
              id={`key-time-${key.id}`}
              type="number"
              required
              min={0}
              max={clip.durationUs / 1e6}
              step="any"
              value={drafts[`time-${key.id}`] ?? String(key.timeUs / 1e6)}
              readOnly={readOnly}
              onChange={(event) => {
                const timeUs = readNumber(
                  event.target,
                  `time-${key.id}`,
                  `point ${index + 1} time`,
                  true,
                );
                if (timeUs === undefined) return;
                replace(
                  keys.map((point) =>
                    point.id === key.id ? { ...point, timeUs } : point,
                  ),
                );
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`key-value-${key.id}`}>
              Point {index + 1} value
            </Label>
            <Input
              id={`key-value-${key.id}`}
              type="number"
              required
              min={field.min}
              max={field.max}
              step="any"
              value={drafts[`value-${key.id}`] ?? String(key.value)}
              readOnly={readOnly}
              onChange={(event) => {
                const value = readNumber(
                  event.target,
                  `value-${key.id}`,
                  `point ${index + 1} value`,
                );
                if (value === undefined) return;
                replace(
                  keys.map((point) =>
                    point.id === key.id ? { ...point, value } : point,
                  ),
                );
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`key-interpolation-${key.id}`}>
              Point {index + 1} interpolation
            </Label>
            <SettingsSelect
              id={`key-interpolation-${key.id}`}
              label={`Point ${index + 1} interpolation`}
              value={key.interpolation}
              selectedLabel={key.interpolation === 'linear' ? 'Linear' : 'Hold'}
              disabled={readOnly}
              options={[
                { value: 'linear', label: 'Linear' },
                { value: 'hold', label: 'Hold' },
              ]}
              onChange={(value) =>
                replace(
                  keys.map((point) =>
                    point.id === key.id
                      ? {
                          ...point,
                          interpolation: value as 'linear' | 'hold',
                        }
                      : point,
                  ),
                )
              }
            />
          </div>
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              aria-label={`Remove point ${index + 1}`}
              onClick={() => {
                removeDrafts([`time-${key.id}`, `value-${key.id}`]);
                replace(keys.filter((point) => point.id !== key.id));
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={keys.some((key) => key.timeUs === localUs)}
            onClick={() => add(localUs)}
          >
            Add at playhead
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={keys.some((key) => key.timeUs === 0)}
            onClick={() => add(0)}
          >
            Add at start
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={keys.some((key) => key.timeUs === clip.durationUs)}
            onClick={() => add(clip.durationUs)}
          >
            Add at end
          </Button>
          {!!keys.length && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                removeDrafts(
                  keys.flatMap((key) => [`time-${key.id}`, `value-${key.id}`]),
                );
                replace([]);
              }}
            >
              Clear property animation
            </Button>
          )}
        </div>
      )}
      {!!Object.keys(invalid).length && (
        <p role="alert" className="text-sm text-destructive">
          Enter a valid value for {Object.values(invalid)[0]}.
        </p>
      )}
    </div>
  );
}
