import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { SettingsSelect } from './SettingsSelect';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { ensureTextFont } from '../media/fonts';
import { Label } from '../components/ui/label';
import { CollapsibleDisclosure } from '../components/ui/collapsible';
import {
  TEXT_FONTS,
  TEXT_TEMPLATES,
  matchesTextLabels,
} from '../core/text-library';
import type { TextStyleInput } from '../core/text-library';
import { paintText } from '../media/text';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '../components/ui/combobox';

export function TextSample({
  style,
  className,
}: {
  style: TextStyleInput;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext('2d')!;
    let disposed = false,
      frame = 0,
      ready = false,
      visible = false;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const draw = (timeUs: number) => {
      ctx.clearRect(0, 0, 600, 240);
      ctx.save();
      ctx.scale(0.5, 0.5);
      ctx.translate(0, 160);
      paintText(
        ctx,
        motion.matches && style.animation?.kind === 'typewriter'
          ? { ...style, animation: undefined }
          : style,
        1200,
        320,
        timeUs,
      );
      ctx.restore();
    };
    const start = performance.now();
    const tick = (now: number) => {
      if (disposed || !visible || !ready) return;
      draw(
        motion.matches
          ? style.animation?.kind === 'typewriter'
            ? 1e12
            : 0
          : (now - start) * 1000,
      );
      if (style.animation && !motion.matches)
        frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry!.isIntersecting;
      cancelAnimationFrame(frame);
      if (visible && !ready) {
        setError('');
        void ensureTextFont(style)
          .then(() => {
            if (disposed) return;
            ready = true;
            tick(performance.now());
          })
          .catch((reason: Error) => {
            if (!disposed) setError(reason.message);
          });
      } else if (visible) tick(performance.now());
    });
    observer.observe(element);
    const changed = () => {
      cancelAnimationFrame(frame);
      tick(performance.now());
    };
    motion.addEventListener('change', changed);
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', changed);
    };
  }, [style]);
  return (
    <>
      <canvas
        ref={canvas}
        width={600}
        height={240}
        className={className ?? 'w-full rounded-md bg-zinc-950'}
        aria-hidden="true"
      />
      {error && (
        <span role="status" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

export function FontPicker({
  value,
  onChange,
}: {
  value: TextStyleInput['fontFamily'];
  onChange: (value: TextStyleInput['fontFamily']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const fonts = TEXT_FONTS.filter((font) => matchesTextLabels(font, query));
  return (
    <Combobox
      items={fonts.slice(0, 60)}
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setQuery('');
      }}
      value={TEXT_FONTS.find((font) => font.id === (value ?? 'sans'))!}
      onValueChange={(font) => {
        if (font) onChange(font.id);
      }}
      itemToStringLabel={(font) => font.name}
      itemToStringValue={(font) => font.id}
      isItemEqualToValue={(a, b) => a.id === b.id}
      filter={matchesTextLabels}
    >
      <ComboboxTrigger aria-label="Font">
        <ComboboxValue />
      </ComboboxTrigger>
      <ComboboxContent
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <ComboboxInput
          aria-label="Search fonts"
          placeholder="Search names or tags…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No matching fonts.</ComboboxEmpty>
        <ComboboxList>
          {(font: (typeof TEXT_FONTS)[number]) => (
            <ComboboxItem key={font.id} value={font}>
              <span>
                <span style={{ fontFamily: font.family }} className="block">
                  {font.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {font.labels.join(' · ')}
                </span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        {fonts.length > 60 && (
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            Search to narrow {fonts.length.toLocaleString()} fonts.
          </p>
        )}
      </ComboboxContent>
    </Combobox>
  );
}

export function TextLibrary({
  busy,
  onInsert,
}: {
  busy: boolean;
  onInsert: (style: TextStyleInput) => void;
}) {
  const [mode, setMode] = useState<'templates' | 'fonts'>('templates');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(0);
  const gallery = useRef<HTMLDivElement>(null);
  const items =
    mode === 'templates'
      ? TEXT_TEMPLATES
      : TEXT_FONTS.map((font) => ({
          ...font,
          style: {
            text: font.sample ?? 'Your story starts here',
            fontSize: 88,
            fontFamily: font.id,
          },
        }));
  const found = items.filter(
    (item) =>
      matchesTextLabels(item, query) && (!tag || item.labels.includes(tag)),
  );
  const pages = Math.ceil(found.length / 24);
  const shown = found.slice(page * 24, (page + 1) * 24);
  const tags =
    mode === 'fonts'
      ? [
          'sans',
          'serif',
          'handwriting',
          'monospace',
          'display',
          'cute',
          'rounded',
          'vietnamese',
        ]
      : [
          'animated',
          'typing',
          'handmade',
          'cute',
          'minimal',
          'curved',
          'shadowed',
        ];
  const navigate = (value: number) => {
    setPage(value);
    gallery.current?.scrollTo({ top: 0 });
  };
  return (
    <div className="grid gap-3">
      <div className="flex gap-2" role="group" aria-label="Text library view">
        <Button
          variant={mode === 'templates' ? 'secondary' : 'ghost'}
          aria-pressed={mode === 'templates'}
          onClick={() => {
            setMode('templates');
            setPage(0);
            setTag('');
          }}
        >
          Templates
        </Button>
        <Button
          variant={mode === 'fonts' ? 'secondary' : 'ghost'}
          aria-pressed={mode === 'fonts'}
          onClick={() => {
            setMode('fonts');
            setPage(0);
            setTag('');
          }}
        >
          Fonts
        </Button>
      </div>
      <Input
        aria-label="Search text library"
        placeholder="Search names or tags: cute, minimal, typing…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          navigate(0);
        }}
      />
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label="Filter tags"
      >
        {tags.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={tag === value ? 'secondary' : 'ghost'}
            aria-pressed={tag === value}
            aria-label={`Filter ${value}`}
            onClick={() => {
              setTag(tag === value ? '' : value);
              navigate(0);
            }}
          >
            {value}
          </Button>
        ))}
      </div>
      {busy && (
        <LoaderCircle className="animate-spin" aria-label="Inserting text" />
      )}
      <div
        ref={gallery}
        className="grid grid-cols-2 gap-3 max-h-[calc(var(--app-viewport-height)*0.55)] overflow-y-auto"
        aria-label={mode === 'templates' ? 'Text templates' : 'Font library'}
      >
        {shown.map((item) => (
          <Button
            key={item.id}
            aria-label={`Insert ${item.name}`}
            disabled={busy}
            variant="outline"
            className="h-auto min-w-0 flex-col items-stretch p-2 text-left"
            onClick={() => onInsert(item.style)}
          >
            <TextSample style={item.style} />
            <span className="truncate text-xs font-medium">{item.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {item.labels.join(' · ')}
            </span>
          </Button>
        ))}
      </div>
      {!found.length && (
        <p role="status" className="text-sm text-muted-foreground">
          No matches. Try another name or tag.
        </p>
      )}
      {found.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span role="status" className="text-xs text-muted-foreground">
            {found.length.toLocaleString()}{' '}
            {mode === 'fonts' ? 'fonts' : 'templates'}
            {pages > 1 ? ` · Page ${page + 1} of ${pages}` : ''}
          </span>
          {pages > 1 && (
            <div className="flex gap-1">
              {page > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(page - 1)}
                >
                  Previous
                </Button>
              )}
              {page + 1 < pages && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(page + 1)}
                >
                  Next
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TextStyleFields({
  style,
  onChange,
  readOnly,
}: {
  style: TextStyleInput;
  onChange: (style: TextStyleInput) => void;
  readOnly?: boolean;
}) {
  const variationsInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const variations = style.animation?.variations;
    variationsInput.current?.setCustomValidity(
      variations &&
        (variations.length < 3 ||
          variations.length > 5 ||
          (style.animation?.frames !== undefined &&
            variations.length !== style.animation.frames) ||
          variations.some((value) => !value.trim()))
        ? `Enter ${style.animation?.frames ?? 4} non-empty lines, or leave empty.`
        : '',
    );
  }, [style.animation]);
  const patch = (values: Partial<TextStyleInput>) =>
    onChange({ ...style, ...values });
  return (
    <div className="grid gap-3">
      <TextSample style={style} />
      {!readOnly && (
        <FontPicker
          value={style.fontFamily}
          onChange={(fontFamily) => patch({ fontFamily })}
        />
      )}
      {!readOnly && (
        <SettingsSelect
          label="Text animation"
          value={style.animation?.kind ?? 'none'}
          options={[
            { value: 'none', label: 'Static' },
            { value: 'typewriter', label: 'Typewriter' },
            { value: 'handmade', label: 'Handmade loop' },
          ]}
          onChange={(kind) =>
            patch({
              animation:
                kind === 'none'
                  ? undefined
                  : {
                      kind: kind as 'typewriter' | 'handmade',
                      stepMs: kind === 'typewriter' ? 90 : 180,
                      loop: kind === 'handmade',
                      frames: kind === 'handmade' ? 4 : undefined,
                    },
            })
          }
        />
      )}
      {style.animation && (
        <CollapsibleDisclosure summary="Animation settings">
          <div className="mt-3 grid gap-3">
            <Label htmlFor="animation-step">
              {style.animation.kind === 'typewriter'
                ? 'Milliseconds per character'
                : 'Milliseconds per frame'}
            </Label>
            <Input
              id="animation-step"
              type="number"
              min={40}
              max={2000}
              required
              readOnly={readOnly}
              value={style.animation.stepMs}
              onChange={(event) =>
                patch({
                  animation: {
                    ...style.animation!,
                    stepMs: Number(event.target.value),
                  },
                })
              }
            />
            {!readOnly && (
              <Button
                type="button"
                variant={style.animation.loop ? 'secondary' : 'outline'}
                aria-pressed={style.animation.loop}
                onClick={() =>
                  patch({
                    animation: {
                      ...style.animation!,
                      loop: !style.animation!.loop,
                    },
                  })
                }
              >
                Loop animation
              </Button>
            )}
            {style.animation.kind === 'handmade' && (
              <>
                {!readOnly && (
                  <SettingsSelect
                    label="Animation frames"
                    value={String(
                      style.animation.frames ??
                        style.animation.variations?.length ??
                        4,
                    )}
                    options={[3, 4, 5].map((frames) => ({
                      value: String(frames),
                      label: `${frames} frames`,
                    }))}
                    onChange={(frames) =>
                      patch({
                        animation: {
                          ...style.animation!,
                          frames: Number(frames),
                          variations: undefined,
                        },
                      })
                    }
                  />
                )}
                <Label htmlFor="animation-variations">
                  Text variations (optional, one per frame)
                </Label>
                <Textarea
                  ref={variationsInput}
                  id="animation-variations"
                  readOnly={readOnly}
                  placeholder="Leave empty to animate the same text"
                  value={style.animation.variations?.join('\n') ?? ''}
                  onChange={(event) => {
                    const variations = event.target.value
                      ? event.target.value.split('\n')
                      : undefined;
                    patch({ animation: { ...style.animation!, variations } });
                  }}
                />
              </>
            )}
          </div>
        </CollapsibleDisclosure>
      )}
      {!readOnly && (
        <SettingsSelect
          label="Text alignment"
          value={style.align ?? 'center'}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(align) =>
            patch({ align: align as 'left' | 'center' | 'right' })
          }
        />
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={style.fontWeight === 'bold' ? 'secondary' : 'outline'}
            aria-pressed={style.fontWeight === 'bold'}
            onClick={() =>
              patch({
                fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold',
              })
            }
          >
            Bold
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.italic ? 'secondary' : 'outline'}
            aria-pressed={!!style.italic}
            onClick={() => patch({ italic: !style.italic })}
          >
            Italic
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.shadow ? 'secondary' : 'outline'}
            aria-pressed={!!style.shadow}
            onClick={() =>
              patch({
                shadow: style.shadow
                  ? undefined
                  : { color: '#000000', blur: 8, offsetX: 4, offsetY: 4 },
              })
            }
          >
            Shadow
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ['fontSize', 'Font size', 64, 0, undefined],
            ['letterSpacing', 'Letter spacing', 0, -10, 100],
            ['curve', 'Curve (degrees)', 0, -180, 180],
            ['outlineWidth', 'Outline width', 0, 0, 20],
          ] as const
        ).map(([key, label, fallback, min, max]) => (
          <div key={key} className="grid gap-1">
            <Label htmlFor={`text-${key}`}>{label}</Label>
            <Input
              id={`text-${key}`}
              type="number"
              min={min}
              max={max}
              step="any"
              required
              readOnly={readOnly}
              value={style[key] ?? fallback}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (key === 'fontSize')
                  event.target.setCustomValidity(
                    value > 0 ? '' : 'Font size must be greater than zero.',
                  );
                patch({ [key]: value });
              }}
            />
          </div>
        ))}
        {(
          [
            ['color', 'Text color', '#ffffff'],
            ['background', 'Highlight color', 'transparent'],
            ['outlineColor', 'Outline color', '#000000'],
          ] as const
        ).map(([key, label, fallback]) => (
          <div key={key} className="grid gap-1">
            <Label htmlFor={`text-${key}`}>{label}</Label>
            <Input
              id={`text-${key}`}
              readOnly={readOnly}
              value={style[key] ?? fallback}
              onChange={(event) => patch({ [key]: event.target.value })}
            />
          </div>
        ))}
      </div>
      {style.shadow && (
        <CollapsibleDisclosure summary="Shadow settings">
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="shadow-color">Shadow color</Label>
              <Input
                id="shadow-color"
                readOnly={readOnly}
                value={style.shadow.color}
                onChange={(event) =>
                  patch({
                    shadow: { ...style.shadow!, color: event.target.value },
                  })
                }
              />
            </div>
            {(['blur', 'offsetX', 'offsetY'] as const).map((key) => (
              <div key={key} className="grid gap-1">
                <Label htmlFor={`shadow-${key}`}>
                  {key === 'blur'
                    ? 'Shadow blur'
                    : key === 'offsetX'
                      ? 'Shadow X'
                      : 'Shadow Y'}
                </Label>
                <Input
                  id={`shadow-${key}`}
                  type="number"
                  required
                  min={key === 'blur' ? 0 : -100}
                  max={100}
                  readOnly={readOnly}
                  value={style.shadow![key]}
                  onChange={(event) =>
                    patch({
                      shadow: {
                        ...style.shadow!,
                        [key]: Number(event.target.value),
                      },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </CollapsibleDisclosure>
      )}
    </div>
  );
}
