import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  headClassName?: string;
  cellClassName?: string;
}

export interface DataTablePagination {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * Renders `Table`/`TableHeader`/`TableBody` from a column config, plus the
 * loading-skeleton/empty-state/pagination-footer variants every hand-rolled
 * table in this app reimplemented slightly differently. Does not render the
 * surrounding `Card`/`CardHeader` — callers keep that, since its content
 * (title, filters, create buttons) varies too much to standardize.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  skeletonRowCount = 5,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  className,
  pagination,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  skeletonRowCount?: number;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  pagination?: DataTablePagination;
}): ReactNode {
  const showEmpty = !loading && rows.length === 0;
  return (
    <>
      <Table className={className}>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.headClassName}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: skeletonRowCount }).map((_, index) => (
                <TableRow key={index}>
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.cellClassName}>
                      <Skeleton className="h-5 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  className={cn(
                    onRowClick &&
                      "cursor-pointer focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter") onRowClick(row);
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.cellClassName}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {showEmpty ? (
        <EmptyState
          compact
          title={emptyTitle}
          {...(emptyDescription !== undefined ? { description: emptyDescription } : {})}
          {...(emptyAction !== undefined ? { action: emptyAction } : {})}
        />
      ) : null}
      {pagination ? (
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!pagination.hasPreviousPage}
            onClick={pagination.onPrevious}
          >
            <ChevronLeft data-icon="inline-start" />
            前へ
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!pagination.hasNextPage}
            onClick={pagination.onNext}
          >
            次へ
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      ) : null}
    </>
  );
}
