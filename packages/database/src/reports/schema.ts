import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { organization } from "../auth/schema";

export const dailyMetrics = sqliteTable(
  "daily_metrics",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    metricDate: text("metric_date").notNull(),
    dimensionType: text("dimension_type").notNull(),
    dimensionId: text("dimension_id").notNull(),
    accepted: integer().default(0).notNull(),
    delivered: integer().default(0).notNull(),
    opened: integer().default(0).notNull(),
    clicked: integer().default(0).notNull(),
    bounced: integer().default(0).notNull(),
    complained: integer().default(0).notNull(),
    unsubscribed: integer().default(0).notNull(),
    failed: integer().default(0).notNull(),
  },
  (table) => [
    index("daily_metrics_workspace_date_idx").on(table.workspaceId, table.metricDate),
    primaryKey({
      columns: [table.workspaceId, table.metricDate, table.dimensionType, table.dimensionId],
      name: "daily_metrics_workspace_id_metric_date_dimension_type_dimension_id_pk",
    }),
  ],
);
