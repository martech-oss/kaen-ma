import type {
  ContactListInput,
  ContactListResult,
  ContactSummary,
} from "@kaenma/contract";
import {
  WorkspaceRepository,
  type KaenmaDatabase,
} from "@kaenma/database";
import type {
  Contact,
  ContactCreate,
  WorkspaceContext,
} from "@kaenma/shared";

export async function listContacts(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: ContactListInput,
): Promise<ContactListResult> {
  const repository = new WorkspaceRepository(database, workspace);
  const page = await repository.listContacts(input);
  const items = await attachContactRelations(
    database,
    workspace.workspaceId,
    page.items,
  );

  return {
    items,
    total: page.total,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

export async function createContact(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: ContactCreate,
): Promise<Contact> {
  const repository = new WorkspaceRepository(database, workspace);
  return repository.createContact(input);
}

async function attachContactRelations(
  database: KaenmaDatabase,
  workspaceId: string,
  contacts: Contact[],
): Promise<ContactSummary[]> {
  if (contacts.length === 0) return [];
  const ids = contacts.map((contact) => contact.id);
  const placeholders = ids.map(() => "?").join(", ");
  const relationResults = await database.batch([
    database
      .prepare(
        `SELECT ct.contact_id, t.id, t.name, t.slug, t.color
         FROM contact_tags ct JOIN tags t
           ON t.workspace_id = ct.workspace_id AND t.id = ct.tag_id
         WHERE ct.workspace_id = ? AND ct.contact_id IN (${placeholders})
         ORDER BY t.name`,
      )
      .bind(workspaceId, ...ids),
    database
      .prepare(
        `SELECT clm.contact_id, cl.id, cl.name, cl.slug, cl.color
         FROM contact_list_memberships clm JOIN contact_lists cl
           ON cl.workspace_id = clm.workspace_id AND cl.id = clm.list_id
         WHERE clm.workspace_id = ? AND clm.status = 'active'
           AND clm.contact_id IN (${placeholders})
         ORDER BY cl.name`,
      )
      .bind(workspaceId, ...ids),
    database
      .prepare(
        `SELECT cc.contact_id, co.id, co.name, co.domain, cc.title, cc.is_primary
         FROM company_contacts cc JOIN companies co
           ON co.workspace_id = cc.workspace_id AND co.id = cc.company_id
         WHERE cc.workspace_id = ? AND cc.contact_id IN (${placeholders})
         ORDER BY cc.is_primary DESC, co.name`,
      )
      .bind(workspaceId, ...ids),
  ]);
  const tagRows = relationResults[0]!;
  const listRows = relationResults[1]!;
  const accountRows = relationResults[2]!;
  const tagsByContact = new Map<
    string,
    ContactSummary["tags"]
  >();
  const listsByContact = new Map<
    string,
    ContactSummary["lists"]
  >();
  const accountsByContact = new Map<
    string,
    ContactSummary["accounts"]
  >();

  for (const row of tagRows.results as Array<{
    contact_id: string;
    id: string;
    name: string;
    slug: string;
    color: string;
  }>) {
    const items = tagsByContact.get(row.contact_id) ?? [];
    items.push({ id: row.id, name: row.name, slug: row.slug, color: row.color });
    tagsByContact.set(row.contact_id, items);
  }

  for (const row of listRows.results as Array<{
    contact_id: string;
    id: string;
    name: string;
    slug: string;
    color: string;
  }>) {
    const items = listsByContact.get(row.contact_id) ?? [];
    items.push({ id: row.id, name: row.name, slug: row.slug, color: row.color });
    listsByContact.set(row.contact_id, items);
  }

  for (const row of accountRows.results as Array<{
    contact_id: string;
    id: string;
    name: string;
    domain: string | null;
    title: string | null;
    is_primary: number;
  }>) {
    const items = accountsByContact.get(row.contact_id) ?? [];
    items.push({
      id: row.id,
      name: row.name,
      domain: row.domain,
      title: row.title,
      is_primary: Boolean(row.is_primary),
    });
    accountsByContact.set(row.contact_id, items);
  }

  return contacts.map((contact) => ({
    ...contact,
    tags: tagsByContact.get(contact.id) ?? [],
    lists: listsByContact.get(contact.id) ?? [],
    accounts: accountsByContact.get(contact.id) ?? [],
  }));
}
