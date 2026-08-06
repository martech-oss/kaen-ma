---
name: analytics-tracking
description: Design or audit a GA4-first analytics tracking plan with business questions, event names, parameters, User ID, Key Events, UTM taxonomy, attribution assumptions, implementation notes, privacy constraints, and QA steps. Use when a user needs GA4, gtag, GTM, conversion tracking, event instrumentation, CTA attribution, or an OpenEngage tracking compatibility handoff.
---

# Analytics Tracking

Produce the smallest GA4 event system that can answer the user's business questions reliably. Treat OpenEngage tracking as a compatibility layer after the GA4 plan.

## Evidence boundary

- Use only journeys, KPIs, URLs, data-layer fields, tools, consent rules, and existing events supplied in the conversation.
- Never claim to have inspected GA4, GTM, a website, or live event data.
- Mark implementation state, event coverage, volumes, attribution evidence, and data quality as unknown unless supplied.
- Do not send events, change tags, or access external analytics systems.

## Procedure

1. Restate the business decisions, primary outcome, funnel or journey, actors, surfaces, consent requirements, and current measurement stack.
2. Read `references/ga4-tracking-plan.md` and define only the events needed to answer those decisions.
3. Use lowercase `snake_case`, verb-first names no longer than 40 characters. Reuse GA4 recommended events when their semantics match.
4. Define each event's trigger, owner, required parameters and types, identity state, deduplication rule, and related Key Event. Never place email addresses, names, phone numbers, or other direct PII in GA4 event parameters.
5. Define opaque User ID behavior only after authentication, plus anonymous-to-known identity expectations, consent gating, UTM naming, and attribution assumptions.
6. Provide gtag or GTM implementation notes appropriate to the supplied stack, then define Realtime, DebugView, data-layer, duplicate-event, and parameter QA.
7. Read `references/openengage-tracking-bridge.md` and add a short OpenEngage mapping for relevant web, contact, automation, email, form, or site-message signals.
8. Route audience conditions to `segment-designer`, email content measurement to `email-sequence`, and exact event-driven graphs to `automation-flow-designer`.

## Output contract

Return:

1. Measurement brief: business questions, KPI, funnel, evidence used, assumptions, privacy boundary, and ownership.
2. GA4 event catalog: event, trigger, parameters/types, User ID state, Key Event status, dedupe key, and implementation owner.
3. Implementation notes: data layer, gtag/GTM mapping, consent timing, User ID, UTM taxonomy, and attribution model assumption.
4. QA matrix: scenario, expected event, expected parameters, tool, pass condition, and failure owner.
5. Reporting map: which GA4 exploration/report answers each business question and the review cadence.
6. OpenEngage compatibility appendix: native call or event, Automation/Segment use, report surface, and any gap.
7. Unresolved items and rollout order.

When GA4 guidance may have changed since the bundled source, label the configuration as requiring confirmation against current official GA4 documentation. If a Markdown artifact helps, write it to `/outputs/analytics-tracking-plan.md`, but include its complete contents in the reply because sandbox files are temporary.

## Attribution

Adapted for OpenEngage from kostja94's `analytics-tracking` at commit `70987bad4ebe9dce1f74858c1c64f3f8810f18e4`, licensed under MIT. The output remains GA4-first while adding privacy guardrails and an OpenEngage compatibility handoff. See `LICENSE`.
