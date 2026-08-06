export interface CursorPage<T> {
  items: T[];
  total: number;
  nextCursor?: string;
}

/** Cap for admin list views with no pagination UI (forms, automations, templates, segments). */
export const UNPAGINATED_LIST_LIMIT = 200;
