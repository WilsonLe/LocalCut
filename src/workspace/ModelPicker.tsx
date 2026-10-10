import { useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { OpenRouterModel } from '../ai';
import { Button } from '../components/ui/button';
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

export function ModelPicker({
  models,
  model,
  onChange,
  loading,
  refresh,
}: {
  models: OpenRouterModel[];
  model: string;
  onChange: (id: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Combobox
      open={open}
      onOpenChange={setOpen}
      items={models}
      value={models.find((item) => item.id === model) ?? null}
      onValueChange={(item) => {
        if (item) onChange(item.id);
      }}
      itemToStringLabel={(item) => item.name}
      itemToStringValue={(item) => item.id}
      isItemEqualToValue={(item, value) => item.id === value.id}
      filter={(item, query) =>
        `${item.name} ${item.id}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      }
    >
      <ComboboxTrigger aria-label="AI model">
        <span className="truncate">
          <ComboboxValue placeholder="Choose a model" />
        </span>
      </ComboboxTrigger>
      <ComboboxContent
        aria-label="Choose AI model"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <div className="flex items-center gap-1 border-b p-2">
          <ComboboxInput
            aria-label="Search models"
            placeholder="Search models…"
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh models"
            title="Refresh models"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? (
              <LoaderCircle
                className="motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
          </Button>
        </div>
        {loading ? (
          <p role="status" className="p-3 text-sm text-muted-foreground">
            Loading models…
          </p>
        ) : (
          <>
            <ComboboxEmpty>
              {models.length
                ? 'No matching models.'
                : 'No models loaded. Try refreshing.'}
            </ComboboxEmpty>
            <ComboboxList>
              {(item: OpenRouterModel) => (
                <ComboboxItem
                  key={item.id}
                  value={item}
                  aria-label={`${item.name} · ${item.id}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.id}
                    </span>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
