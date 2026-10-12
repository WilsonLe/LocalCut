import { useEffect, useRef, useState } from 'react';
import { COLOR_PRESETS, BLEND_MODES, parseCube } from '../core/effects';
import type { Mask } from '../core/effects';
import type { Clip, EditOperation, Job } from '../editor';
import type { MaskTrackingResult } from '../media/mask-tracking';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { SettingsSelect } from './SettingsSelect';
type Patch = Extract<EditOperation, { type: 'updateClip' }>['patch'];
function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState({ text: String(value), value });
  // Keep incomplete native number input (minus/decimal) local, and reflect explicit resets.
  if (draft.value !== value) setDraft({ text: String(value), value });
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        required
        value={draft.text}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const text = event.target.value,
            numeric = Number(text),
            valid = text !== '' && Number.isFinite(numeric);
          setDraft({ text, value: valid ? numeric : value });
          if (valid) onChange(numeric);
        }}
        onBlur={() => {
          if (draft.text === '' || !Number.isFinite(Number(draft.text)))
            setDraft({ text: String(value), value });
        }}
      />
    </div>
  );
}

export function ClipEffectFields({
  clip,
  patch,
  onChange,
  disabled,
  onTrackMask,
  onTracking,
  playheadUs,
}: {
  clip: Clip;
  patch: Patch;
  onChange: (patch: Patch) => void;
  disabled?: boolean;
  onTrackMask?: (mask: Mask) => Job<MaskTrackingResult>;
  onTracking: (active: boolean) => void;
  playheadUs: number;
}) {
  const value = { ...clip, ...patch },
    audio = ['audio', 'video'].includes(clip.kind),
    visual = clip.kind !== 'audio';
  const [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const [tracking, setTracking] = useState(false);
  const job = useRef<Job<MaskTrackingResult> | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      job.current?.cancel();
    },
    [],
  );
  const number = (
    name: string,
    label: string,
    current: number,
    min: number,
    max: number,
    change: (n: number) => void,
    step = 'any',
  ) => (
    <NumberField
      key={name}
      id={'effect-' + name}
      label={label}
      value={current}
      min={min}
      max={max}
      step={step}
      onChange={change}
    />
  );
  const choose = (
    label: string,
    current: string,
    options: { id: string; label: string }[],
    change: (v: string) => void,
  ) => (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <SettingsSelect
        label={label}
        value={current}
        selectedLabel={options.find((o) => o.id === current)?.label}
        options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={change}
      />
    </div>
  );
  return (
    <>
      <fieldset disabled={disabled || tracking} className="grid gap-3">
        {visual && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Color
            </summary>
            <div className="grid gap-3 pt-3">
              {choose(
                'Color preset',
                value.colorPreset ?? 'none',
                [...COLOR_PRESETS],
                (colorPreset) =>
                  onChange({ colorPreset: colorPreset as Clip['colorPreset'] }),
              )}
              <Label htmlFor="effect-lut">Import .cube LUT</Label>
              <Input
                id="effect-lut"
                type="file"
                accept=".cube"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  const token = ++generation.current;
                  try {
                    if (file.size > 16 * 1024 * 1024)
                      throw new Error('LUT file exceeds 16 MiB');
                    const colorLut = parseCube(await file.text());
                    if (token !== generation.current) return;
                    onChange({ colorLut });
                    setError('');
                  } catch (e) {
                    if (token === generation.current)
                      setError(
                        e instanceof Error ? e.message : 'Could not read LUT',
                      );
                  }
                }}
              />
              {value.colorLut && (
                <div className="flex items-center gap-2 text-sm">
                  <span>{value.colorLut.size}³ LUT</span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onChange({ colorLut: null })}
                  >
                    Remove LUT
                  </Button>
                </div>
              )}
              {number(
                'strength',
                'Color strength',
                value.colorStrength ?? 1,
                0,
                1,
                (colorStrength) => onChange({ colorStrength }),
              )}
            </div>
          </details>
        )}
        {audio && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Audio
            </summary>
            <div className="grid grid-cols-1 gap-3 pt-3 min-[400px]:grid-cols-2">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value.muted}
                  onChange={(e) => onChange({ muted: e.target.checked })}
                />
                Mute clip
              </Label>
              {number(
                'balance',
                'Balance (left −1 / right 1)',
                value.balance ?? 0,
                -1,
                1,
                (balance) => onChange({ balance }),
              )}
              {number(
                'fade-in',
                'Fade in (seconds)',
                value.fadeInUs / 1e6,
                0,
                (value.fadeEnvelope?.durationUs ?? clip.durationUs) / 1e6,
                (v) => onChange({ fadeInUs: Math.round(v * 1e6) }),
              )}
              {number(
                'fade-out',
                'Fade out (seconds)',
                value.fadeOutUs / 1e6,
                0,
                (value.fadeEnvelope?.durationUs ?? clip.durationUs) / 1e6,
                (v) => onChange({ fadeOutUs: Math.round(v * 1e6) }),
              )}
              {(['lowDb', 'midDb', 'highDb'] as const).map((key, i) =>
                number(
                  key,
                  ['Bass (dB)', 'Mid (dB)', 'Treble (dB)'][i]!,
                  value.equalizer?.[key] ?? 0,
                  -12,
                  12,
                  (v) =>
                    onChange({
                      equalizer: {
                        lowDb: 0,
                        midDb: 0,
                        highDb: 0,
                        ...value.equalizer,
                        [key]: v,
                      },
                    }),
                ),
              )}
              {number(
                'noise',
                'Noise reduction',
                value.noiseReduction ?? 0,
                0,
                1,
                (noiseReduction) => onChange({ noiseReduction }),
              )}
              {!!value.noiseReduction &&
                number(
                  'noise-floor',
                  'Noise floor (dB)',
                  value.noiseFloorDb ?? -50,
                  -80,
                  -10,
                  (noiseFloorDb) => onChange({ noiseFloorDb }),
                )}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    balance: 0,
                    equalizer: null,
                    noiseReduction: 0,
                    muted: false,
                    fadeInUs: 0,
                    fadeOutUs: 0,
                  })
                }
              >
                Reset audio effects
              </Button>
            </div>
          </details>
        )}
        {visual && (
          <>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Blending
              </summary>
              <div className="grid gap-3 pt-3">
                {choose(
                  'Blend mode',
                  value.blendMode ?? 'source-over',
                  [...BLEND_MODES],
                  (blendMode) =>
                    onChange({ blendMode: blendMode as Clip['blendMode'] }),
                )}
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Mask
              </summary>
              <div className="grid gap-3 pt-3">
                {choose(
                  'Mask shape',
                  value.mask?.shape ?? 'none',
                  [
                    { id: 'none', label: 'None' },
                    { id: 'rectangle', label: 'Rectangle' },
                    { id: 'ellipse', label: 'Ellipse' },
                  ],
                  (shape) =>
                    onChange({
                      mask:
                        shape === 'none'
                          ? null
                          : {
                              x: 0.25,
                              y: 0.25,
                              width: 0.5,
                              height: 0.5,
                              invert: false,
                              feather: 0,
                              ...value.mask,
                              shape: shape as Mask['shape'],
                            },
                    }),
                )}
                {value.mask && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {(['x', 'y', 'width', 'height'] as const).map((key) =>
                        number(
                          'mask-' + key,
                          'Mask ' + key,
                          value.mask![key],
                          key === 'width' || key === 'height' ? 0.001 : 0,
                          1,
                          (v) =>
                            onChange({
                              mask: {
                                ...value.mask!,
                                [key]: v,
                                points: undefined,
                              },
                            }),
                        ),
                      )}
                    </div>
                    {number(
                      'feather',
                      'Mask feather (pixels)',
                      value.mask.feather,
                      0,
                      100,
                      (feather) =>
                        onChange({ mask: { ...value.mask!, feather } }),
                    )}
                    <Label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={value.mask.invert}
                        onChange={(e) =>
                          onChange({
                            mask: { ...value.mask!, invert: e.target.checked },
                          })
                        }
                      />
                      Invert mask
                    </Label>
                    {value.mask.points?.length && (
                      <>
                        <span className="text-sm">
                          {value.mask.points.length} motion points
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            onChange({
                              mask: { ...value.mask!, points: undefined },
                            })
                          }
                        >
                          Clear mask motion
                        </Button>
                      </>
                    )}
                    <details>
                      <summary className="cursor-pointer text-sm">
                        Motion points
                      </summary>
                      <div className="grid gap-3 pt-3">
                        {(value.mask.points ?? []).map((point, index) => (
                          <div key={index} className="grid grid-cols-3 gap-2">
                            {number(
                              'point-time-' + index,
                              `Motion point ${index + 1} time (seconds)`,
                              point.timeUs / 1e6,
                              0,
                              clip.durationUs / 1e6,
                              (v) =>
                                onChange({
                                  mask: {
                                    ...value.mask!,
                                    points: value.mask!.points!.map((p, i) =>
                                      i === index
                                        ? { ...p, timeUs: Math.round(v * 1e6) }
                                        : p,
                                    ),
                                  },
                                }),
                            )}
                            {(['x', 'y'] as const).map((key) =>
                              number(
                                'point-' + key + '-' + index,
                                `Motion point ${index + 1} ${key}`,
                                point[key],
                                0,
                                1 -
                                  value.mask![key === 'x' ? 'width' : 'height'],
                                (v) =>
                                  onChange({
                                    mask: {
                                      ...value.mask!,
                                      points: value.mask!.points!.map((p, i) =>
                                        i === index ? { ...p, [key]: v } : p,
                                      ),
                                    },
                                  }),
                              ),
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                onChange({
                                  mask: {
                                    ...value.mask!,
                                    points: value.mask!.points!.filter(
                                      (_, i) => i !== index,
                                    ),
                                  },
                                })
                              }
                            >
                              Remove motion point {index + 1}
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            const timeUs = Math.max(
                              0,
                              Math.min(
                                clip.durationUs,
                                playheadUs - clip.startUs,
                              ),
                            );
                            if (
                              value.mask!.points?.some(
                                (p) => p.timeUs === timeUs,
                              )
                            ) {
                              setError(
                                'A motion point already exists at the playhead',
                              );
                              return;
                            }
                            onChange({
                              mask: {
                                ...value.mask!,
                                points: [
                                  ...(value.mask!.points ?? []),
                                  {
                                    timeUs,
                                    x: value.mask!.x,
                                    y: value.mask!.y,
                                  },
                                ].sort((a, b) => a.timeUs - b.timeUs),
                              },
                            });
                          }}
                        >
                          Add motion point at playhead
                        </Button>
                      </div>
                    </details>
                    {clip.kind === 'video' && onTrackMask && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={async () => {
                          const token = ++generation.current;
                          setError('');
                          onTracking(true);
                          setTracking(true);
                          try {
                            const current = onTrackMask(value.mask!);
                            job.current = current;
                            setStatus('Tracking mask…');
                            const unsubscribe = current.subscribe((p) => {
                              if (token === generation.current)
                                setStatus(
                                  p.progress === undefined
                                    ? 'Tracking mask…'
                                    : `Tracking mask ${Math.round(p.progress * 100)}%`,
                                );
                            });
                            try {
                              const result = await current.completion;
                              if (token === generation.current) {
                                onChange({ mask: result.mask });
                                setStatus(
                                  `Tracked ${result.mask.points?.length ?? 0} motion points`,
                                );
                              }
                            } finally {
                              unsubscribe();
                            }
                          } catch (e) {
                            if (token === generation.current)
                              setError(
                                e instanceof Error
                                  ? e.message
                                  : 'Mask tracking failed',
                              );
                          } finally {
                            if (token === generation.current) {
                              job.current = null;
                              onTracking(false);
                              setTracking(false);
                            }
                          }
                        }}
                      >
                        Track mask
                      </Button>
                    )}
                  </>
                )}
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Chroma key
              </summary>
              <div className="grid gap-3 pt-3">
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!value.chromaKey}
                    onChange={(e) =>
                      onChange({
                        chromaKey: e.target.checked
                          ? {
                              color: '#00ff00',
                              tolerance: 0.1,
                              softness: 0.1,
                              spill: 0.5,
                            }
                          : null,
                      })
                    }
                  />
                  Enable chroma key
                </Label>
                {value.chromaKey && (
                  <>
                    <Label htmlFor="effect-key-color">Key color</Label>
                    <Input
                      id="effect-key-color"
                      type="color"
                      value={value.chromaKey.color}
                      onChange={(e) =>
                        onChange({
                          chromaKey: {
                            ...value.chromaKey!,
                            color: e.target.value,
                          },
                        })
                      }
                    />
                    {(['tolerance', 'softness', 'spill'] as const).map((key) =>
                      number(
                        'key-' + key,
                        'Key ' + key,
                        value.chromaKey![key],
                        0,
                        1,
                        (v) =>
                          onChange({
                            chromaKey: { ...value.chromaKey!, [key]: v },
                          }),
                      ),
                    )}
                  </>
                )}
              </div>
            </details>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="text-sm">
            {status}
          </p>
        )}
      </fieldset>
      {tracking && (
        <Button
          type="button"
          variant="outline"
          onClick={() => job.current?.cancel()}
        >
          Cancel tracking
        </Button>
      )}
    </>
  );
}
