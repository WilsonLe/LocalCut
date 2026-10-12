import { ClipEffectFields } from './ClipEffectFields';
import type { Mask } from '../core/effects';
import type { Job } from '../editor';
import type { MaskTrackingResult } from '../media/mask-tracking';
import { useState } from 'react';
import { averageSpeed, sourceDurationUs } from '../core/speed';
import type { SpeedRamp } from '../core/speed';
import type { Parameter } from '../core/model';
import type { Clip, EditOperation } from '../editor';
import type { TextStyleInput } from '../core/text-library';
import { SpeedRampEditor } from './SpeedRampEditor';
import { KeyframeEditor } from './KeyframeEditor';
import { TextStyleFields } from './TextLibrary';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { SettingsSelect } from './SettingsSelect';

export default function ClipProperties({
  clip,
  busy,
  readOnly,
  onSave,
  playheadUs,
  onTrackMask,
}: {
  clip: Clip;
  busy: boolean;
  readOnly?: boolean;
  onSave: (operations: EditOperation[]) => void;
  playheadUs: number;
  onTrackMask?: (mask: Mask) => Job<MaskTrackingResult>;
}) {
  const [effects, setEffects] = useState<
    Extract<EditOperation, { type: 'updateClip' }>['patch']
  >({});
  const [tracking, setTracking] = useState(false);
  const [keyframes, setKeyframes] = useState<Clip['keyframes']>(() =>
    structuredClone(clip.keyframes),
  );
  const [baseChanges, setBaseChanges] = useState<
    Partial<Record<Parameter, number>>
  >({});
  const [animationValid, setAnimationValid] = useState(true);
  const duplicateTimes = Object.values(keyframes).some(
    (keys) => new Set(keys.map((key) => key.timeUs)).size !== keys.length,
  );
  const [ramp, setRamp] = useState<SpeedRamp | undefined>(clip.speedRamp);
  const [pitchMode, setPitchMode] = useState<'change' | 'preserve'>(
    clip.pitchMode ?? 'change',
  );
  const isTimedSource = clip.kind === 'video' || clip.kind === 'audio';
  const [style, setStyle] = useState<TextStyleInput | undefined>(clip.text);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (readOnly || busy || tracking || duplicateTimes || !animationValid)
          return;
        const form = new FormData(event.currentTarget);
        const startUs = Math.round(Number(form.get('start')) * 1e6),
          enteredDurationUs = Math.round(Number(form.get('duration')) * 1e6),
          speed = form.has('speed') ? Number(form.get('speed')) : clip.speed,
          gain = Number(form.get('gain'));
        const durationChanged = enteredDurationUs !== clip.durationUs;
        const durationUs =
          isTimedSource &&
          !clip.loop &&
          !durationChanged &&
          (speed !== clip.speed ||
            JSON.stringify(ramp) !== JSON.stringify(clip.speedRamp))
            ? sourceDurationUs(
                { speed, speedRamp: ramp },
                clip.sourceOutUs! - clip.sourceInUs,
              )
            : enteredDurationUs;
        const patch: Extract<EditOperation, { type: 'updateClip' }>['patch'] = {
          ...baseChanges,
          startUs,
          durationUs,
          speed,
          gain,
          ...(isTimedSource ? { pitchMode } : {}),
        };
        if (isTimedSource && durationChanged && !clip.loop)
          patch.sourceOutUs =
            clip.sourceInUs +
            Math.round(durationUs * averageSpeed({ speed, speedRamp: ramp }));
        if (clip.text)
          patch.text = { ...style!, text: String(form.get('text') ?? '') };
        const operations: EditOperation[] = [];
        // Publish drafted curves before timing commands so the shared engine owns
        // rescaling and clipping both edited and untouched parameter curves.
        const drafted = { ...effects };
        if (JSON.stringify(keyframes) !== JSON.stringify(clip.keyframes))
          drafted.keyframes = Object.fromEntries(
            Object.entries(keyframes).map(([parameter, keys]) => [
              parameter,
              [...keys].sort((a, b) => a.timeUs - b.timeUs),
            ]),
          );
        if (Object.keys(drafted).length)
          operations.push({
            type: 'updateClip',
            clipId: clip.id,
            patch: drafted,
          });
        if (clip.groupId && startUs !== clip.startUs) {
          operations.push({
            type: 'moveGroup',
            groupId: clip.groupId,
            deltaUs: startUs - clip.startUs,
          });
          delete patch.startUs;
        }
        if (
          isTimedSource &&
          (speed !== clip.speed ||
            JSON.stringify(ramp) !== JSON.stringify(clip.speedRamp))
        )
          operations.push(
            ramp
              ? {
                  type: 'setSpeedRamp',
                  clipId: clip.id,
                  points: ramp,
                  pitchMode,
                }
              : { type: 'setSpeed', clipId: clip.id, speed, pitchMode },
          );
        if (clip.loop) {
          delete patch.durationUs;
          if (durationChanged)
            operations.push({
              type: 'resizeClip',
              clipId: clip.id,
              durationUs: enteredDurationUs,
            });
        }
        onSave([...operations, { type: 'updateClip', clipId: clip.id, patch }]);
      }}
      className="flex min-h-0 flex-col gap-4 overflow-hidden"
    >
      <div className="grid min-h-0 gap-4 overflow-y-auto px-1 -mx-1">
        <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
          {[
            {
              name: 'start',
              label: 'Start (seconds)',
              value: clip.startUs / 1e6,
              min: 0,
              max: undefined,
            },
            {
              name: 'duration',
              label: 'Duration (seconds)',
              value: clip.durationUs / 1e6,
              min: 0.000001,
              max: undefined,
            },
            {
              name: 'speed',
              label: 'Speed',
              value: clip.speed,
              min: 0.25,
              max: 4,
            },
            { name: 'gain', label: 'Gain', value: clip.gain, min: 0, max: 16 },
          ]
            .filter((field) => field.name !== 'speed' || !ramp)
            .map((field) => (
              <div className="grid gap-2" key={field.name}>
                <Label htmlFor={`clip-${field.name}`}>{field.label}</Label>
                <Input
                  id={`clip-${field.name}`}
                  name={field.name}
                  type="number"
                  required
                  min={field.min}
                  max={field.max}
                  step="any"
                  readOnly={readOnly}
                  defaultValue={field.value}
                  onChange={
                    field.name === 'gain'
                      ? (event) =>
                          setBaseChanges((values) => ({
                            ...values,
                            gain: Number(event.target.value),
                          }))
                      : undefined
                  }
                />
              </div>
            ))}
        </div>
        <ClipEffectFields
          clip={clip}
          patch={effects}
          onChange={(patch) =>
            setEffects((current) => ({ ...current, ...patch }))
          }
          disabled={readOnly || busy}
          onTrackMask={onTrackMask}
          onTracking={setTracking}
          playheadUs={playheadUs}
        />
        <KeyframeEditor
          clip={{ ...clip, ...baseChanges }}
          keyframes={keyframes}
          onChange={setKeyframes}
          onValidityChange={setAnimationValid}
          onBaseChange={(parameter, value) =>
            setBaseChanges((values) => ({ ...values, [parameter]: value }))
          }
          playheadUs={playheadUs}
          readOnly={readOnly || busy}
        />
        {duplicateTimes && (
          <p role="alert" className="text-sm text-destructive">
            Each point in a property needs a distinct time.
          </p>
        )}
        {isTimedSource && (
          <>
            <Label htmlFor="audio-pitch">Audio pitch</Label>
            <SettingsSelect
              id="audio-pitch"
              selectedLabel={
                pitchMode === 'preserve' ? 'Keep pitch' : 'Change pitch'
              }
              label="Audio pitch"
              value={pitchMode}
              disabled={readOnly}
              onChange={(value) => setPitchMode(value as 'change' | 'preserve')}
              options={[
                { value: 'change', label: 'Change pitch' },
                { value: 'preserve', label: 'Keep pitch' },
              ]}
            />
            <SpeedRampEditor
              points={ramp}
              onChange={setRamp}
              readOnly={readOnly}
            />
          </>
        )}
        {clip.text && (
          <div className="grid gap-2">
            <Label htmlFor="clip-text">Text</Label>
            <Textarea
              id="clip-text"
              name="text"
              readOnly={readOnly}
              defaultValue={clip.text.text}
              onChange={(event) =>
                setStyle({ ...style!, text: event.target.value })
              }
            />
          </div>
        )}
        {style && (
          <TextStyleFields
            style={style}
            onChange={setStyle}
            readOnly={readOnly}
          />
        )}
      </div>
      <DialogFooter className="shrink-0">
        {!readOnly && (
          <Button
            type="submit"
            disabled={busy || tracking || duplicateTimes || !animationValid}
          >
            Apply properties
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
