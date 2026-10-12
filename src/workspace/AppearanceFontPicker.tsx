import { useState } from 'react';
import { matchesTextLabels } from '../core/text-library';
import { appearanceFontChoices } from './appearance-fonts';
import type { AppearanceFont } from './appearance';
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

const inherited = {
  id: 'inherit' as const,
  name: 'Same as body',
  labels: [] as string[],
};
type Choice = (typeof appearanceFontChoices)[number] | typeof inherited;

export function AppearanceFontPicker({
  label,
  value,
  onChange,
}: {
  label: 'Font' | 'Heading';
  value: AppearanceFont | 'inherit';
  onChange: (value: AppearanceFont | 'inherit') => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const choices: Choice[] =
    label === 'Heading'
      ? [inherited, ...appearanceFontChoices]
      : appearanceFontChoices;
  const matches = choices.filter((font) => matchesTextLabels(font, query));
  return (
    <div className="appearance-field">
      <label id={`appearance-${label.toLowerCase()}-label`}>{label}</label>
      <Combobox<Choice>
        items={matches.slice(0, 60)}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
        value={choices.find((font) => font.id === value) ?? null}
        onValueChange={(font) => {
          if (font) onChange(font.id);
        }}
        itemToStringLabel={(font) => font.name}
        itemToStringValue={(font) => font.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        filter={matchesTextLabels}
      >
        <ComboboxTrigger
          aria-labelledby={`appearance-${label.toLowerCase()}-label`}
        >
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
            aria-label={`Search ${label === 'Font' ? 'body' : 'heading'} fonts`}
            placeholder="Search names or tags…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <ComboboxEmpty>No matching fonts.</ComboboxEmpty>
          <ComboboxList>
            {(font: Choice) => (
              <ComboboxItem
                key={font.id}
                value={font}
                aria-label={font.name}
                aria-description={font.labels.join(' · ')}
              >
                <span>
                  <span className="block">{font.name}</span>
                  {font.labels.length > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {font.labels.join(' · ')}
                    </span>
                  )}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
          {matches.length > 60 && (
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              Search to narrow {matches.length.toLocaleString()} fonts.
            </p>
          )}
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
