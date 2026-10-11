import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { SettingsSelect } from './SettingsSelect';
import {
  ASPECT_RATIOS,
  FRAME_RATES,
  aspectRatioFor,
  resolutionPresets,
} from './project-format';
import type { ProjectFormat } from './project-format';

export function NewProjectForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (name: string, settings: ProjectFormat) => void;
}) {
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const [frameRate, setFrameRate] = useState('30/1');
  const aspectRatio = aspectRatioFor(Number(width), Number(height));
  const resolutions = resolutionPresets(aspectRatio);
  const resolution =
    resolutions.find(
      (item) => item.width === Number(width) && item.height === Number(height),
    )?.value ?? 'custom';
  const setDimensions = (dimensions: { width: number; height: number }) => {
    setWidth(String(dimensions.width));
    setHeight(String(dimensions.height));
  };

  return (
    <form
      className="new-project-form"
      onSubmit={(event) => {
        event.preventDefault();
        const name = String(
          new FormData(event.currentTarget).get('name') ?? '',
        ).trim();
        const rate = FRAME_RATES.find((item) => item.value === frameRate);
        if (!name || !rate) return;
        onCreate(name, {
          width: Number(width),
          height: Number(height),
          frameRate: { num: rate.num, den: rate.den },
        });
      }}
    >
      <div className="new-project-field">
        <Label htmlFor="project-name">Project name</Label>
        <Input
          id="project-name"
          name="name"
          defaultValue="Untitled project"
          required
          maxLength={1000}
          autoFocus
          disabled={busy}
        />
      </div>
      <div className="new-project-field">
        <Label htmlFor="project-aspect-ratio">Aspect ratio</Label>
        <SettingsSelect
          id="project-aspect-ratio"
          label="Aspect ratio"
          value={aspectRatio}
          selectedLabel={
            ASPECT_RATIOS.find((item) => item.value === aspectRatio)?.label ??
            'Custom'
          }
          disabled={busy}
          options={
            aspectRatio === 'custom'
              ? [...ASPECT_RATIOS, { value: 'custom', label: 'Custom' }]
              : ASPECT_RATIOS
          }
          onChange={(value) => {
            const presets = resolutionPresets(value);
            const next =
              presets.find((item) => item.value === resolution) ??
              presets.find((item) => item.value === '1080');
            if (next) setDimensions(next);
          }}
        />
      </div>
      <div className="new-project-field">
        <Label htmlFor="project-resolution">Resolution</Label>
        <SettingsSelect
          id="project-resolution"
          label="Resolution"
          value={resolution}
          selectedLabel={
            resolutions.find((item) => item.value === resolution)?.label ??
            'Custom'
          }
          disabled={busy || aspectRatio === 'custom'}
          options={
            resolution === 'custom'
              ? [...resolutions, { value: 'custom', label: 'Custom' }]
              : resolutions
          }
          onChange={(value) => {
            const next = resolutions.find((item) => item.value === value);
            if (next) setDimensions(next);
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[
          {
            id: 'width',
            label: 'Width (px)',
            value: width,
            max: 3840,
            change: setWidth,
          },
          {
            id: 'height',
            label: 'Height (px)',
            value: height,
            max: 2160,
            change: setHeight,
          },
        ].map((field) => (
          <div className="new-project-field" key={field.id}>
            <Label htmlFor={`project-${field.id}`}>{field.label}</Label>
            <Input
              id={`project-${field.id}`}
              name={field.id}
              type="number"
              required
              min={1}
              max={field.max}
              step={1}
              value={field.value}
              disabled={busy}
              onChange={(event) => field.change(event.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="new-project-field">
        <Label htmlFor="project-frame-rate">Frame rate (fps)</Label>
        <SettingsSelect
          id="project-frame-rate"
          label="Frame rate (fps)"
          value={frameRate}
          selectedLabel={
            FRAME_RATES.find((item) => item.value === frameRate)?.label
          }
          disabled={busy}
          options={FRAME_RATES}
          onChange={setFrameRate}
        />
      </div>
      <DialogFooter>
        <Button disabled={busy} type="submit">
          {busy && <LoaderCircle className="animate-spin" />}Create project
        </Button>
      </DialogFooter>
    </form>
  );
}
