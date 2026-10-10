import { Info, Settings2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '../components/ui/popover';

export default function AIInfoPopover({
  modelName,
  providerName,
  configure,
  open,
  onOpenChange,
}: {
  modelName?: string;
  providerName?: string;
  configure: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="AI settings"
            title="AI provider settings"
          />
        }
      >
        <Info aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side="top" aria-label="AI information">
        <PopoverTitle className="font-medium">
          {providerName ?? 'AI providers'}
        </PopoverTitle>
        <PopoverDescription className="mt-1 break-words text-muted-foreground">
          {modelName ?? 'Choose a model'}
        </PopoverDescription>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full"
          onClick={() => {
            onOpenChange(false);
            configure();
          }}
        >
          <Settings2 aria-hidden="true" />
          Configure AI
        </Button>
      </PopoverContent>
    </Popover>
  );
}
