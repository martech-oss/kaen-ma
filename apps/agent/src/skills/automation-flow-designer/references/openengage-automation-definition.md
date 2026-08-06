# OpenEngage AutomationDefinition Reference

Read this reference before producing automation JSON.

## Root

```json
{
  "name": "Trial onboarding",
  "description": "Move new trials toward first value.",
  "timezone": "UTC",
  "nodes": [],
  "edges": []
}
```

- `name`: 1–191 trimmed characters.
- `description`: at most 2,000 characters; defaults to an empty string.
- `timezone`: non-empty string; defaults to `UTC`.
- `nodes`: 1–500 nodes.
- `edges`: at most 1,000 edges.

Every node has a non-empty `id`, a `type`, numeric `position.x` and `position.y`, and a type-specific `config`.

## Source nodes

Use exactly one source node.

| `config.source`    | Required config           | Re-entry                                     |
| ------------------ | ------------------------- | -------------------------------------------- |
| `segment_joined`   | `segmentId`               | `once` or `every_time`; default `once`       |
| `form_submitted`   | `formId`                  | `once` or `every_time`; default `once`       |
| `contact_created`  | —                         | `once` only                                  |
| `api_event`        | `eventName` (1–120 chars) | `once` or `every_time`; default `every_time` |
| `webhook_event`    | `eventName` (1–120 chars) | `once` or `every_time`; default `every_time` |
| `contact_inactive` | `days` (1–3,650)          | `once` only                                  |

Example:

```json
{
  "id": "source-1",
  "type": "source",
  "position": { "x": 0, "y": 0 },
  "config": { "source": "segment_joined", "segmentId": "segment-id", "reentry": "once" }
}
```

## Action nodes

Set `type` to `action` and choose one config:

- `send_email`: `templateId`, optional `topicId`.
- `send_webhook`: `endpointId`.
- `add_tag` / `remove_tag`: `tagId`.
- `add_segment` / `remove_segment`: `segmentId`.
- `change_score`: integer `amount`.
- `update_field`: `field` (1–191 chars) and JSON-compatible `value`.

Publishing an email action requires a real published, unarchived transactional template. Structural validation cannot verify that requirement or any other referenced resource ID.

## Condition nodes

Set `type` to `condition`. The config is `{ "field", "operator", "value" }`. Operators are `eq`, `neq`, `contains`, `starts_with`, `in`, `gt`, `gte`, `lt`, `lte`, `exists`, and `not_exists`. Prefer documented OpenEngage scalar contact fields. The condition-node schema has no `key`, so do not pretend it can express keyed `event` or `custom_field` segment conditions.

A condition must branch with `yes` and/or `no` edges.

## Decision nodes

Set `type` to `decision`. Config contains:

- `event`: `opened`, `clicked`, `replied`, `page_viewed`, `form_submitted`, or `custom_event`.
- optional `resourceId`.
- `withinMinutes`: positive integer up to 525,600.

A decision may branch with `yes`, `no`, and `timeout` edges.

## Delay nodes

Set `type` to `delay` and choose one config:

- Relative: `{ "mode": "relative", "minutes": 1..525600 }`.
- Absolute: `{ "mode": "absolute", "at": "ISO-8601 datetime" }`.
- Window: `{ "mode": "window", "minutes": 1..525600, "weekdays": [0..6], "startHour": 0..23, "endHour": 1..24 }`.

## Edges and graph rules

Each edge is `{ "id", "source", "target", "branch" }`.

- Source, action, and delay nodes use `next`.
- Condition nodes use `yes` or `no`.
- Decision nodes use `yes`, `no`, or `timeout`.
- Keep node IDs and edge IDs unique.
- Reference existing endpoints only.
- Ensure exactly one source, no cycles, and all nodes reachable from the source.
- Do not create two outgoing edges with the same branch from one node, even though the core graph validator does not currently reject that ambiguity.
