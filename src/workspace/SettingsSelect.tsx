import { lazy, Suspense } from 'react';

export interface SettingsSelectProps {
  label: string;
  id?: string;
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  selectedLabel?: string;
  options: { value: string; label: string }[];
}

const SelectField = lazy(() => import('./SelectField'));

/** Settings-only primitives load when their containing dialog opens. */
export function SettingsSelect(props: SettingsSelectProps) {
  return (
    <Suspense
      fallback={<span role="status">Loading {props.label.toLowerCase()}…</span>}
    >
      <SelectField {...props} />
    </Suspense>
  );
}
