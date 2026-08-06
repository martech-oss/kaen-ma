---
name: automation-flow-designer
description: Compile a marketing or lifecycle brief and target segment into a validated OpenEngage AutomationDefinition with nodes, edges, branches, delays, actions, and unresolved resource IDs. Use when a user needs implementable automation flow JSON, graph repair, trigger/action selection, or a handoff ready for OpenEngage draft creation.
---

# Automation Flow Designer

Compile one focused lifecycle intervention into OpenEngage's exact automation graph. Produce a design only; never create, publish, or mutate an automation.

## Evidence boundary

- Use only requirements, IDs, event names, templates, and constraints supplied in the conversation.
- Keep unknown resource IDs visible as unresolved placeholders rather than pretending they exist.
- Do not claim a flow is publishable merely because its schema and graph are valid.
- Never call an OpenEngage API or write to persistent storage.

## Procedure

1. Confirm the outcome, audience or segment, lifecycle trigger, consent/suppression expectations, exit behavior, and measurement signal.
2. Select one supported source and the smallest useful sequence of action, condition, decision, and delay nodes.
3. Read `references/openengage-automation-definition.md` before constructing JSON.
4. Give every node and edge a stable unique ID. Lay out nodes left to right with numeric `x`/`y` positions.
5. Connect every node from the single source. Use only the branches allowed by each source-node type, and do not create cycles or duplicate outgoing branches.
6. For `send_email`, require an ID for a published, unarchived transactional template. When that status or ID is unknown, keep it in unresolved resources and set the final state to `publishable-blocked`.
7. Call `validate_automation_definition` with the complete definition. Repair every schema or graph issue and call it again until `valid` is `true`.
8. Return the normalized definition from the validator, not the unvalidated draft.

Activate `email-sequence` before graph compilation when full email copy, cadence, and message-level logic are still unresolved. Activate `analytics-tracking` when entry, decision, conversion, or QA events need a GA4-first tracking specification.

## Output contract

Return:

1. Human flow: entry, eligibility, ordered actions, branches, delays, exits, consent/suppression, and measurement.
2. Complete normalized `AutomationDefinition` JSON.
3. Unresolved resources: every template, topic, webhook endpoint, tag, segment, form, event name, or other ID requiring workspace verification.
4. Validation result: schema and graph validation must be `valid: true`.
5. State:
   - `publishable-blocked` when any required resource ID, published transactional-template proof, approval, or delivery guardrail is unresolved.
   - `structurally-valid` when the graph passes validation and no known publish blocker remains. This still does not replace server-side publish validation.

If a Markdown artifact helps, write it to `/outputs/automation-flow.md`, but include its complete contents in the reply because sandbox files are temporary.
