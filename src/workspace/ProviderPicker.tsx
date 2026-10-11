import { useState } from 'react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../components/ui/combobox';

interface ProviderOption {
  id: string;
  name: string;
}

/** Select only the connected, service-capable providers supplied by the owner. */
export function ProviderPicker({
  label,
  providers,
  selectedId,
  selectedName,
  emptyMessage,
  disabled,
  onChange,
}: {
  label: string;
  providers: ProviderOption[];
  selectedId?: string;
  selectedName?: string;
  emptyMessage: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Combobox
      open={open}
      onOpenChange={setOpen}
      items={providers}
      value={providers.find((p) => p.id === selectedId) ?? null}
      onValueChange={(provider) => {
        if (provider) onChange(provider.id);
      }}
      itemToStringLabel={(provider) => provider.name}
      itemToStringValue={(provider) => provider.id}
      isItemEqualToValue={(a, b) => a.id === b.id}
      filter={(provider, query) =>
        provider.name.toLowerCase().includes(query.trim().toLowerCase())
      }
    >
      <ComboboxTrigger aria-label={label} disabled={disabled}>
        <span className="truncate">{selectedName ?? 'Add provider'}</span>
      </ComboboxTrigger>
      <ComboboxContent
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <div className="border-b p-2">
          <ComboboxInput
            aria-label="Search connected providers"
            placeholder="Search providers…"
          />
        </div>
        <ComboboxEmpty>
          {providers.length ? 'No matching providers.' : emptyMessage}
        </ComboboxEmpty>
        <ComboboxList>
          {(provider: ProviderOption) => (
            <ComboboxItem key={provider.id} value={provider}>
              {provider.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
