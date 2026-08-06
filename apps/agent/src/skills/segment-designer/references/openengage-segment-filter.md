# OpenEngage SegmentFilter Reference

Read this reference before producing dynamic segment JSON.

## Structure

A filter is one condition or a recursive group. A group contains 1–25 children.

```json
{
  "kind": "group",
  "combinator": "and",
  "children": [
    {
      "kind": "condition",
      "field": "status",
      "operator": "eq",
      "value": "active"
    }
  ]
}
```

A condition always contains `kind`, `field`, `operator`, and `value`. Add `key` only for keyed fields. Use `null` as the value for `exists` and `not_exists`.

## Fields and operators

| Field                                                                         | Value meaning                                   | Allowed operators                                                    | Key                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- | ---------------------- |
| `email`, `first_name`, `last_name`, `phone`, `external_id`, `stage`, `status` | Text                                            | `eq`, `neq`, `contains`, `starts_with`, `in`, `exists`, `not_exists` | Omit                   |
| `score`                                                                       | Number                                          | `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, `not_exists`  | Omit                   |
| `created_at`, `updated_at`                                                    | ISO date/time string                            | `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, `not_exists`  | Omit                   |
| `tag`                                                                         | Tag slug                                        | `eq`, `neq`, `exists`, `not_exists`                                  | Omit                   |
| `segment`                                                                     | Static segment slug                             | `eq`, `neq`, `exists`, `not_exists`                                  | Omit                   |
| `company`                                                                     | Company name                                    | `eq`, `neq`, `exists`, `not_exists`                                  | Omit                   |
| `subscription`                                                                | Subscription-topic slug; match means subscribed | `eq`, `neq`, `exists`, `not_exists`                                  | Omit                   |
| `event`                                                                       | Contact has an event of the type in `key`       | `eq`, `neq`, `exists`, `not_exists`                                  | Required event type    |
| `custom_field`                                                                | Contact JSON custom-field value                 | All supported operators                                              | Required JSON-path key |

Supported operators are `eq`, `neq`, `contains`, `starts_with`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, and `not_exists`.

## Value rules

- Values may be a string, number, boolean, string/number array, or `null`.
- Use a non-empty array for `in` even though the schema permits an empty array.
- Use `null` for unary existence checks; do not invent a comparison value.
- For `event`, put the event type in `key`; the compiler ignores `value`.
- Keep custom-field keys to letters, digits, `_`, `.`, and `-`; database compilation rejects other JSON-path characters even if schema validation succeeds.
- `neq` and `not_exists` on relationship fields compile as absence of the relationship.

## Consent and suppression

- A `subscription` condition can require membership in a supplied topic slug with subscribed status.
- Global suppression and delivery frequency are enforced outside `SegmentFilter`. Record them as delivery guardrails and unresolved checks, never as unsupported fields.
- Structural validation does not prove that a tag, segment, company, topic, event type, or custom-field key exists in a workspace.
