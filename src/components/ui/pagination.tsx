import type { ComponentProps } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './button';

function Pagination({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      data-slot="pagination"
      aria-label="Pagination"
      className={cn('mx-auto flex w-full shrink-0 justify-center', className)}
      {...props}
    />
  );
}
function PaginationContent({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn(
        'flex flex-wrap items-center justify-center gap-0.5',
        className,
      )}
      {...props}
    />
  );
}
function PaginationItem(props: ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />;
}
// Local table pages change view state, so use Base UI buttons instead of links.
function PaginationLink({
  isActive,
  ...props
}: ComponentProps<typeof Button> & { isActive?: boolean }) {
  return (
    <Button
      data-slot="pagination-link"
      aria-current={isActive ? 'page' : undefined}
      variant={isActive ? 'outline' : 'ghost'}
      size="icon-sm"
      {...props}
    />
  );
}
function PaginationEllipsis() {
  return (
    <span
      data-slot="pagination-ellipsis"
      className="flex size-8 items-center justify-center"
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
      <span className="sr-only">More pages</span>
    </span>
  );
}
export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationEllipsis,
};
