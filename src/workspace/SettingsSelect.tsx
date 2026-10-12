import { onDemand } from './on-demand';

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

const SelectField = onDemand(
  () => import('./SelectField'),
  (props) => <span role="status">Loading {props.label.toLowerCase()}…</span>,
);

/** Settings-only primitives load when their containing dialog opens. */
export function SettingsSelect(props: SettingsSelectProps) {
  return <SelectField {...props} />;
}
