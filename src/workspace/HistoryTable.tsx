import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Table } from '../components/ui/table';
import { Button } from '../components/ui/button';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationEllipsis,
} from '../components/ui/pagination';

const pageSize = 10;
export function useHistoryPage(count: number) {
  const [selectedPage, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(selectedPage, pageCount);
  if (page !== selectedPage) setPage(page);
  return {
    page,
    pageCount,
    setPage,
    start: (page - 1) * pageSize,
    end: page * pageSize,
  };
}

export function HistoryTable({
  page,
  pageCount,
  onPageChange,
  label,
  className,
  children,
  ...props
}: ComponentProps<typeof Table> & {
  label: string;
  page: number;
  pageCount: number;
  onPageChange(page: number): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const update = () => {
      setCompact(container.clientWidth < 360);
      setEdges({
        left: container.scrollLeft > 1,
        right:
          container.scrollWidth - container.clientWidth - container.scrollLeft >
          1,
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    const table = container.querySelector('table');
    if (table) observer.observe(table);
    container.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', update);
    };
  }, []);
  const scrollColumn = (direction: -1 | 1) => {
    const container = scrollRef.current;
    const table = container?.querySelector('table');
    if (!container || !table) return;
    const scale =
      container.clientWidth / container.getBoundingClientRect().width;
    const start = table.getBoundingClientRect().left;
    const boundaries = Array.from(
      table.querySelectorAll('thead th'),
      (cell) => (cell.getBoundingClientRect().left - start) * scale,
    );
    const current = container.scrollLeft;
    const target =
      direction === 1
        ? (boundaries.find((position) => position > current + 1) ??
          container.scrollWidth)
        : ([...boundaries]
            .reverse()
            .find((position) => position < current - 1) ?? 0);
    container.scrollTo({
      left: Math.max(
        0,
        Math.min(target, container.scrollWidth - container.clientWidth),
      ),
      behavior: 'instant',
    });
  };
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page]);
  const candidates = compact
    ? page > 2 && page < pageCount - 1
      ? [1, page, pageCount]
      : [1, 2, page, pageCount - 1, pageCount]
    : [1, 2, page - 1, page, page + 1, pageCount - 1, pageCount];
  const numbers = [...new Set(candidates)]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b);
  return (
    <>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border">
        <Table
          {...props}
          className={className}
          containerProps={{
            ref: scrollRef,
            tabIndex: 0,
            role: 'region',
            'aria-label': `${label} columns`,
            className:
              'min-h-0 max-h-[min(32rem,calc(var(--app-viewport-height)-14rem))] flex-1 overflow-auto rounded-lg focus-visible:outline-2 focus-visible:outline-ring',
          }}
        >
          {children}
        </Table>
        {([-1, 1] as const).map((direction) => {
          const left = direction === -1;
          if (!(left ? edges.left : edges.right)) return null;
          return (
            <div
              key={direction}
              className={`pointer-events-none absolute inset-y-0 z-20 flex w-12 items-center ${left ? 'left-0 justify-start rounded-l-lg bg-gradient-to-r pl-1' : 'right-0 justify-end rounded-r-lg bg-gradient-to-l pr-1'} from-muted to-transparent`}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className="pointer-events-auto rounded-none border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
                aria-label={`Scroll one column ${left ? 'left' : 'right'}`}
                onClick={() => scrollColumn(direction)}
              >
                {left ? <ChevronLeft /> : <ChevronRight />}
              </Button>
            </div>
          );
        })}
      </div>
      {pageCount > 1 && (
        <Pagination aria-label={`${label} pages`}>
          <PaginationContent>
            {page > 1 && (
              <PaginationItem>
                <PaginationLink
                  aria-label="Go to previous page"
                  onClick={() => onPageChange(page - 1)}
                >
                  <ChevronLeft />
                </PaginationLink>
              </PaginationItem>
            )}
            {numbers.map((number, index) => (
              <PaginationItem
                key={number}
                className="flex items-center gap-0.5"
              >
                {index > 0 && number - numbers[index - 1]! > 1 && (
                  <PaginationEllipsis />
                )}
                <PaginationLink
                  aria-label={`Go to page ${number}`}
                  isActive={page === number}
                  onClick={() => onPageChange(number)}
                >
                  {number}
                </PaginationLink>
              </PaginationItem>
            ))}
            {page < pageCount && (
              <PaginationItem>
                <PaginationLink
                  aria-label="Go to next page"
                  onClick={() => onPageChange(page + 1)}
                >
                  <ChevronRight />
                </PaginationLink>
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}
    </>
  );
}
