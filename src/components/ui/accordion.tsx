import type { ReactNode } from 'react';
import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion';
import { ChevronDown } from 'lucide-react';

/** A single disclosure with the same semantics and motion as the shared accordions. */
export function AccordionDisclosure({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <AccordionPrimitive.Root>
      <AccordionPrimitive.Item>
        <AccordionPrimitive.Header>
          <AccordionPrimitive.Trigger className="group flex min-h-9 w-full items-center gap-2 rounded-md py-2 text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0 flex-1">{summary}</span>
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-data-open:rotate-180"
            />
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        <AccordionPrimitive.Panel className="h-(--accordion-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
          <div className="pb-2">{children}</div>
        </AccordionPrimitive.Panel>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  );
}
