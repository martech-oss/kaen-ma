---
name: segment-designer
description: Design a static or dynamic OpenEngage audience segment from a targeting goal, eligibility rules, exclusions, consent requirements, and available data. Use when a user needs precise audience criteria, SegmentFilter JSON, segmentation logic, suppression guardrails, or a validated handoff from a journey or marketing automation brief.
---

# Segment Designer

Turn an audience idea into an implementable OpenEngage segment without inventing data, member counts, or platform capabilities.

## Evidence boundary

- Use only facts, field names, event names, IDs, slugs, and counts supplied in the conversation.
- Mark unverified values and resource identifiers as unresolved.
- Report audience size as measured only when the user supplies a measurement; otherwise report it as unknown.
- Never read or mutate OpenEngage data. Return a design artifact only.

## Procedure

1. Restate the purpose, target audience, lifecycle moment, and measurable use of the segment.
2. Inventory the available contact fields, relationship slugs/names, event types, custom-field keys, consent topics, and exclusions.
3. Choose `static` when membership is an explicit curated/imported list. Choose `dynamic` when membership can be evaluated from supported data.
4. For a dynamic segment, translate every criterion into the exact `SegmentFilter` structure in `references/openengage-segment-filter.md`.
5. Keep delivery-time controls separate from filter logic. Global suppressions, frequency caps, and template eligibility are not segment fields.
6. Call `validate_segment_filter` with the complete dynamic filter. Repair every reported issue and call it again until `valid` is `true`.
7. Return the human-readable logic and the normalized JSON returned by the validator. For a static segment, return `filter: null`, describe the membership source, and state that filter validation is not applicable.

## Design rules

- Prefer the narrowest evidence-backed audience that can answer the stated business question.
- Make inclusion, exclusion, consent, re-entry relevance, and data freshness explicit.
- Use an `and` group for required conditions and an `or` group only when any child is sufficient.
- Do not encode a global suppression check as a fictional field. Name it as a delivery guardrail.
- Do not treat a structurally valid filter as proof that referenced slugs, event types, or custom-field keys exist.

## Output contract

Return:

1. Segment decision: purpose, kind, audience, inclusion, exclusion, consent/suppression, and refresh expectation.
2. Data inventory: confirmed inputs, assumptions, and unresolved keys/slugs.
3. JSON artifact with `name`, `slug`, `kind`, and `filter`; add `membershipSource` for a static segment.
4. Validation: tool result for dynamic filters, or `not-applicable` for static membership.
5. Size: `measured` with supplied count and source, or `unknown` with the measurement needed.

If a Markdown artifact helps, write it to `/outputs/segment-design.md`, but include its complete contents in the reply because sandbox files are temporary.

## Attribution

Adapted for OpenEngage from Aaron He Zhu's `list-segment-builder` at commit `dc62cd825fe0193724773b9ea8db627ef14d7b94`, licensed under Apache-2.0. See `LICENSE`.
