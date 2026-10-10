import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { SettingsSelect } from './SettingsSelect';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
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
  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!;
    ctx.clearRect(0, 0, 600, 240);
    ctx.save();
    ctx.scale(0.5, 0.5);
    ctx.translate(0, 160);
    paintText(ctx, style, 1200, 320);
    ctx.restore();
  }, [style]);
  return (
    <canvas
      ref={canvas}
      width={600}
      height={240}
      className={className ?? 'w-full rounded-md bg-zinc-950'}
      aria-hidden="true"
    />
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
  return (
    <Combobox
      items={TEXT_FONTS}
      open={open}
      onOpenChange={setOpen}
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
          placeholder="Search names or labels…"
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
  const items =
    mode === 'templates'
      ? TEXT_TEMPLATES
      : TEXT_FONTS.map((font) => ({
          ...font,
          style: {
            text: 'Your story starts here',
            fontSize: 88,
            fontFamily: font.id,
          },
        }));
  const found = items.filter((item) => matchesTextLabels(item, query));
  return (
    <div className="grid gap-3">
      <div className="flex gap-2" role="group" aria-label="Text library view">
        <Button
          variant={mode === 'templates' ? 'secondary' : 'ghost'}
          aria-pressed={mode === 'templates'}
          onClick={() => setMode('templates')}
        >
          Templates
        </Button>
        <Button
          variant={mode === 'fonts' ? 'secondary' : 'ghost'}
          aria-pressed={mode === 'fonts'}
          onClick={() => setMode('fonts')}
        >
          Fonts
        </Button>
      </div>
      <Input
        aria-label="Search text library"
        placeholder="Search names or labels: cute, minimal, curved…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {busy && (
        <LoaderCircle className="animate-spin" aria-label="Inserting text" />
      )}
      <div
        className="grid grid-cols-2 gap-3 max-h-[calc(var(--app-viewport-height)*0.55)] overflow-y-auto"
        aria-label={mode === 'templates' ? 'Text templates' : 'Font library'}
      >
        {found.map((item) => (
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
          No matches. Try another name or label.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Local system fonts; the available typeface depends on your device.
      </p>
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
