import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import type { SettingsSelectProps } from './SettingsSelect';

export default function SelectField(props: SettingsSelectProps) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => props.onChange(value ?? '')}
    >
      <SelectTrigger
        id={props.id}
        aria-label={props.label}
        className="w-full"
        disabled={props.disabled}
      >
        <SelectValue placeholder={props.placeholder}>
          {props.selectedLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
