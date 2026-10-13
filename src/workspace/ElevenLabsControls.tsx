import type { ElevenLabsSettings } from '../ai/elevenlabs';
import {
  elevenLabsCapabilities,
  validElevenLabsSettings,
} from '../ai/elevenlabs';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { SettingsSelect } from './SettingsSelect';

export function ElevenLabsControls({
  model,
  value,
  onChange,
}: {
  model: string;
  value: ElevenLabsSettings;
  onChange: (value: ElevenLabsSettings) => void;
}) {
  const c = elevenLabsCapabilities(model)!;
  const patch = (key: keyof ElevenLabsSettings, next: unknown) =>
    onChange({ ...value, [key]: next });
  const numeric = (
    key: 'stability' | 'similarity_boost' | 'speed' | 'style' | 'seed',
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <div className="space-y-2" key={key}>
      <Label htmlFor={`elevenlabs-${key}`}>{label}</Label>
      <Input
        id={`elevenlabs-${key}`}
        type="number"
        min={min}
        max={max}
        step={step}
        placeholder="Provider default"
        value={value[key] ?? ''}
        onChange={(event) =>
          patch(
            key,
            event.target.value === '' ? undefined : Number(event.target.value),
          )
        }
      />
    </div>
  );
  return (
    <section aria-label="ElevenLabs voice controls" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {numeric('stability', 'Stability', 0, 1, 0.05)}
        {c.similarity && numeric('similarity_boost', 'Similarity', 0, 1, 0.05)}
        {c.speed && numeric('speed', 'Speaking rate (×)', 0.7, 1.2, 0.05)}
      </div>
      <details className="space-y-4 rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced voice settings
        </summary>
        <div className="grid gap-4 sm:grid-cols-2">
          {numeric('seed', 'Seed', 0, 4294967295, 1)}
          {c.style && numeric('style', 'Style strength', 0, 1, 0.05)}
          {c.speakerBoost && (
            <div className="space-y-2">
              <Label>Speaker boost</Label>
              <SettingsSelect
                label="Speaker boost"
                selectedLabel={
                  value.use_speaker_boost === undefined
                    ? 'Provider default'
                    : value.use_speaker_boost
                      ? 'On'
                      : 'Off'
                }
                value={
                  value.use_speaker_boost === undefined
                    ? 'default'
                    : String(value.use_speaker_boost)
                }
                options={[
                  { value: 'default', label: 'Provider default' },
                  { value: 'true', label: 'On' },
                  { value: 'false', label: 'Off' },
                ]}
                onChange={(v) =>
                  patch(
                    'use_speaker_boost',
                    v === 'default' ? undefined : v === 'true',
                  )
                }
              />
            </div>
          )}
          {c.language && (
            <div className="space-y-2">
              <Label htmlFor="elevenlabs-language">Language code</Label>
              <Input
                id="elevenlabs-language"
                value={value.language_code ?? ''}
                maxLength={2}
                placeholder="e.g. en, vi, ja"
                onChange={(event) =>
                  onChange({
                    ...value,
                    language_code: event.target.value || undefined,
                    apply_language_text_normalization:
                      event.target.value === 'ja'
                        ? value.apply_language_text_normalization
                        : undefined,
                  })
                }
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Text normalization</Label>
            <SettingsSelect
              label="Text normalization"
              selectedLabel={
                value.apply_text_normalization ?? 'Provider default'
              }
              value={value.apply_text_normalization ?? 'default'}
              options={['default', 'auto', 'on', 'off'].map((v) => ({
                value: v,
                label: v === 'default' ? 'Provider default' : v,
              }))}
              onChange={(v) =>
                patch(
                  'apply_text_normalization',
                  v === 'default' ? undefined : v,
                )
              }
            />
          </div>
          {c.language && value.language_code === 'ja' && (
            <div className="space-y-2">
              <Label>Japanese normalization</Label>
              <SettingsSelect
                label="Japanese normalization"
                selectedLabel={
                  value.apply_language_text_normalization === undefined
                    ? 'Provider default'
                    : value.apply_language_text_normalization
                      ? 'On'
                      : 'Off'
                }
                value={
                  value.apply_language_text_normalization === undefined
                    ? 'default'
                    : String(value.apply_language_text_normalization)
                }
                options={[
                  { value: 'default', label: 'Provider default' },
                  { value: 'true', label: 'On' },
                  { value: 'false', label: 'Off' },
                ]}
                onChange={(v) =>
                  patch(
                    'apply_language_text_normalization',
                    v === 'default' ? undefined : v === 'true',
                  )
                }
              />
            </div>
          )}
        </div>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pronunciation dictionaries require your ElevenLabs account connected
            through OpenRouter BYOK.
          </p>
          {(value.pronunciation_dictionary_locators ?? []).map(
            (dictionary, index) => (
              <div key={index} className="space-y-2">
                <Label htmlFor={`elevenlabs-dictionary-${index}`}>
                  Pronunciation dictionary {index + 1}
                </Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id={`elevenlabs-dictionary-${index}`}
                    className="min-w-0 flex-1"
                    placeholder="Dictionary ID"
                    value={dictionary.pronunciation_dictionary_id}
                    onChange={(event) =>
                      patch(
                        'pronunciation_dictionary_locators',
                        value.pronunciation_dictionary_locators!.map((d, i) =>
                          i === index
                            ? {
                                ...d,
                                pronunciation_dictionary_id: event.target.value,
                              }
                            : d,
                        ),
                      )
                    }
                  />
                  <Input
                    aria-label={`Dictionary ${index + 1} version`}
                    className="min-w-0 flex-1"
                    placeholder="Version ID (optional)"
                    value={dictionary.version_id ?? ''}
                    onChange={(event) =>
                      patch(
                        'pronunciation_dictionary_locators',
                        value.pronunciation_dictionary_locators!.map((d, i) =>
                          i === index
                            ? {
                                ...d,
                                version_id: event.target.value || undefined,
                              }
                            : d,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      patch(
                        'pronunciation_dictionary_locators',
                        value.pronunciation_dictionary_locators!.filter(
                          (_, i) => i !== index,
                        ),
                      )
                    }
                  >
                    Remove dictionary {index + 1}
                  </Button>
                </div>
              </div>
            ),
          )}
          <Button
            variant="outline"
            disabled={
              (value.pronunciation_dictionary_locators?.length ?? 0) >= 3
            }
            onClick={() =>
              patch('pronunciation_dictionary_locators', [
                ...(value.pronunciation_dictionary_locators ?? []),
                { pronunciation_dictionary_id: '' },
              ])
            }
          >
            Add pronunciation dictionary
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['previous_text', 'next_text'] as const).map((key) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`elevenlabs-${key}`}>
                {key === 'previous_text' ? 'Previous text' : 'Next text'}
              </Label>
              <Input
                id={`elevenlabs-${key}`}
                maxLength={5000}
                value={value[key] ?? ''}
                onChange={(event) =>
                  patch(key, event.target.value || undefined)
                }
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Seed improves repeatability; the selected voice identifies the
          speaker.
        </p>
      </details>
      {!validElevenLabsSettings(model, value) && (
        <p role="alert" className="text-sm text-destructive">
          Use the displayed ranges and complete each pronunciation dictionary
          ID.
        </p>
      )}
    </section>
  );
}
