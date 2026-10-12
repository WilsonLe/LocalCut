import { useEffect, useRef } from 'react';
import { Moon, Monitor, Sun, Shuffle, RotateCcw, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { SettingsSelect } from './SettingsSelect';
import { AppearanceFontPicker } from './AppearanceFontPicker';
import {
  appearanceOptions,
  defaultAppearance,
  randomAppearance,
  loadAppearanceFonts,
  retryAppearanceFonts,
  saveAppearance,
  themeColors,
  useAppearance,
  type Appearance,
} from './appearance';

const labels: Record<keyof Appearance, string> = {
  mode: 'Mode',
  base: 'Base color',
  theme: 'Theme',
  font: 'Font',
  heading: 'Heading',
  radius: 'Radius',
  density: 'Density',
  interfaceSize: 'Interface size',
  menuColor: 'Menu color',
  menuAccent: 'Menu accent',
};
const optionLabel = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const sizeLabel = (value: string) =>
  ({ default: 'Default (100%)', small: 'Small (75%)', large: 'Large (125%)' })[
    value
  ] ?? optionLabel(value);

export default function AppearancePanel({ onClose }: { onClose: () => void }) {
  const { preferences, saved, fontLoading, fontError } = useAppearance();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    void loadAppearanceFonts().catch(() => {});
  }, []);
  function picker(
    key: Exclude<keyof Appearance, 'mode' | 'theme' | 'font' | 'heading'>,
  ) {
    return (
      <div className="appearance-field" key={key}>
        <label htmlFor={`appearance-${key}`}>{labels[key]}</label>
        <SettingsSelect
          id={`appearance-${key}`}
          label={labels[key]}
          value={preferences[key]}
          selectedLabel={
            key === 'interfaceSize'
              ? sizeLabel(preferences[key])
              : optionLabel(preferences[key])
          }
          options={appearanceOptions[key].map((value) => ({
            value,
            label:
              key === 'interfaceSize' ? sizeLabel(value) : optionLabel(value),
          }))}
          onChange={(value) => saveAppearance({ ...preferences, [key]: value })}
        />
      </div>
    );
  }
  return (
    <section
      className="appearance-panel"
      aria-label="Appearance customization"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="appearance-header">
        <h2>Appearance</h2>
        <Button
          ref={close}
          variant="ghost"
          size="icon-sm"
          aria-label="Close appearance"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="appearance-controls">
        <div className="appearance-modes" role="group" aria-label="Color mode">
          {appearanceOptions.mode.map((mode, index) => {
            const Icon = [Sun, Moon, Monitor][index]!;
            return (
              <Button
                key={mode}
                size="sm"
                variant={preferences.mode === mode ? 'secondary' : 'ghost'}
                aria-pressed={preferences.mode === mode}
                onClick={() => saveAppearance({ ...preferences, mode })}
              >
                <Icon />
                {optionLabel(mode)}
              </Button>
            );
          })}
        </div>
        {picker('base')}
        <fieldset className="appearance-field">
          <legend>Theme</legend>
          <div className="appearance-swatches">
            {appearanceOptions.theme.map((theme) => {
              const [chroma, hue, light] = themeColors[theme];
              return (
                <Button
                  key={theme}
                  variant="outline"
                  size="icon-sm"
                  aria-label={`${optionLabel(theme)} theme`}
                  aria-pressed={preferences.theme === theme}
                  title={optionLabel(theme)}
                  onClick={() => saveAppearance({ ...preferences, theme })}
                >
                  <span
                    className="appearance-swatch"
                    style={{ background: `oklch(${light} ${chroma} ${hue})` }}
                  />
                </Button>
              );
            })}
          </div>
        </fieldset>
        <div className="appearance-divider" />
        {picker('interfaceSize')}
        <AppearanceFontPicker
          label="Heading"
          value={preferences.heading}
          onChange={(heading) => saveAppearance({ ...preferences, heading })}
        />
        <AppearanceFontPicker
          label="Font"
          value={preferences.font}
          onChange={(font) => {
            if (font !== 'inherit') saveAppearance({ ...preferences, font });
          }}
        />
        {picker('radius')}
        {picker('density')}
        <div className="appearance-divider" />
        {picker('menuColor')}
        {picker('menuAccent')}
      </div>
      <div className="appearance-footer">
        {fontLoading && <p role="status">Loading fonts…</p>}
        {fontError && (
          <div role="alert">
            <p>{fontError}</p>
            <Button variant="outline" size="sm" onClick={retryAppearanceFonts}>
              Retry fonts
            </Button>
          </div>
        )}
        <p role="status">
          {saved
            ? 'Saved in this browser'
            : 'Changes apply now, but could not be saved in this browser.'}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveAppearance(randomAppearance())}
          >
            <Shuffle />
            Randomize
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => saveAppearance(defaultAppearance, true)}
          >
            <RotateCcw />
            Reset
          </Button>
        </div>
      </div>
    </section>
  );
}
