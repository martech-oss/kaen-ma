import { primitiveString } from "../platform/values";
import {
  firstRow,
  publicRange,
  type ReportDatabase,
  type ReportRange,
  rows,
  toNumber,
} from "./shared";

export async function contactReport(
  database: ReportDatabase,
  workspaceId: string,
  range: ReportRange,
) {
  const results = await database.batch([
    database
      .prepare(
        `SELECT
           COUNT(*) AS total_contacts,
           COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_contacts,
           COUNT(CASE WHEN status != 'active' THEN 1 END) AS inactive_contacts,
           COUNT(CASE WHEN status = 'anonymous' THEN 1 END) AS anonymous_contacts,
           COUNT(CASE WHEN created_at >= ? AND created_at < ? THEN 1 END) AS new_contacts,
           COUNT(CASE WHEN archived_at >= ? AND archived_at < ? THEN 1 END) AS archived_contacts
         FROM contacts
         WHERE workspace_id = ?`,
      )
      .bind(
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        workspaceId,
      ),
    database
      .prepare(
        `WITH contact_changes AS (
           SELECT date(created_at) AS day, 1 AS added, 0 AS archived
           FROM contacts
           WHERE workspace_id = ? AND created_at >= ? AND created_at < ?
           UNION ALL
           SELECT date(archived_at) AS day, 0 AS added, 1 AS archived
           FROM contacts
           WHERE workspace_id = ? AND archived_at >= ? AND archived_at < ?
         )
         SELECT day, SUM(added) AS added, SUM(archived) AS archived
         FROM contact_changes
         GROUP BY day
         ORDER BY day`,
      )
      .bind(
        workspaceId,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
        workspaceId,
        range.fromTimestamp,
        range.toExclusiveTimestamp,
      ),
    database
      .prepare(
        `SELECT t.id, t.name, t.color,
                COUNT(c.id) AS contact_count
         FROM tags t
         LEFT JOIN contact_tags ct
           ON ct.workspace_id = t.workspace_id AND ct.tag_id = t.id
         LEFT JOIN contacts c
           ON c.workspace_id = ct.workspace_id AND c.id = ct.contact_id
              AND c.status = 'active'
         WHERE t.workspace_id = ?
         GROUP BY t.id
         ORDER BY contact_count DESC, t.name ASC
         LIMIT 10`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT cl.id, cl.name, cl.color,
                COUNT(CASE WHEN clm.status = 'active' AND c.status = 'active' THEN 1 END)
                  AS contact_count
         FROM contact_lists cl
         LEFT JOIN contact_list_memberships clm
           ON clm.workspace_id = cl.workspace_id AND clm.list_id = cl.id
         LEFT JOIN contacts c
           ON c.workspace_id = clm.workspace_id AND c.id = clm.contact_id
         WHERE cl.workspace_id = ?
         GROUP BY cl.id
         ORDER BY contact_count DESC, cl.name ASC
         LIMIT 10`,
      )
      .bind(workspaceId),
  ] as const);
  const summary = firstRow(results[0]);
  return {
    category: "contacts" as const,
    range: publicRange(range),
    summary: {
      totalContacts: toNumber(summary["total_contacts"]),
      activeContacts: toNumber(summary["active_contacts"]),
      inactiveContacts: toNumber(summary["inactive_contacts"]),
      anonymousContacts: toNumber(summary["anonymous_contacts"]),
      newContacts: toNumber(summary["new_contacts"]),
      archivedContacts: toNumber(summary["archived_contacts"]),
    },
    trend: rows(results[1]).map((row) => ({
      day: primitiveString(row["day"]),
      added: toNumber(row["added"]),
      archived: toNumber(row["archived"]),
    })),
    topTags: rows(results[2]).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      color: primitiveString(row["color"]),
      contactCount: toNumber(row["contact_count"]),
    })),
    topLists: rows(results[3]).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      color: primitiveString(row["color"]),
      contactCount: toNumber(row["contact_count"]),
    })),
  };
}
