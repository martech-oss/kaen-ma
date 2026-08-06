---
name: marketing-automation
description: Design a focused marketing automation brief for acquisition, onboarding, engagement, retention, reactivation, or measurement. Use when a user needs to turn a broad growth or lifecycle goal into a concrete audience, trigger, flow, owner, and measurable next action.
license: MIT
compatibility: Designed for the OpenEngage Flue agent. Works from information supplied in the conversation and does not perform external web research.
metadata:
  author: OpenEngage
  version: "1.0.0"
---

# Marketing Automation

Turn a broad marketing request into one actionable automation brief. Prefer a small, testable flow over a large collection of unrelated tactics.

## Evidence boundary

- Use facts, attachments, and constraints supplied in the conversation.
- Do not imply that external research was performed.
- Label missing data as an assumption and explain what evidence would change the recommendation.
- Distinguish a strategic recommendation from a capability already implemented in OpenEngage.

## Procedure

1. Restate the business outcome in one sentence.
2. Identify the audience and the lifecycle moment being changed.
3. Choose one primary motion: acquisition, onboarding, engagement, retention, reactivation, or measurement.
4. Define one entry trigger, any eligibility or exclusion rules, the smallest useful action sequence, and an exit condition.
5. Assign an owner and call out required data, content, approvals, and product dependencies.
6. Select one outcome metric, one early signal, a baseline or explicit assumption, and a review point.
7. Return the brief using the format in `references/operator-brief.md`.

Read `references/routing.md` when the request spans several lifecycle stages or channels. Read `references/measurement.md` when the KPI, event coverage, or experiment design is unclear.

## Routing

- Activate `customer-journey-map` when the user first needs an end-to-end view of stages, touchpoints, emotions, and friction.
- Activate `segment-designer` when the brief needs implementable audience eligibility, exclusion, consent, or SegmentFilter rules.
- Activate `email-sequence` when the intervention needs complete copy, cadence, message-level branches, and exits across multiple emails.
- Activate `automation-flow-designer` after the audience, trigger, actions, and measurement are clear enough to compile into OpenEngage graph JSON.
- Activate `analytics-tracking` when the measurement brief needs GA4 events, Key Events, UTM conventions, implementation, or QA details.
- Stay in this skill when the user needs a concrete automation, lifecycle intervention, or measurement brief.
- If the request is only for finished copy, provide a compact copy handoff after the automation brief rather than inventing a larger campaign.

## Output rules

- Recommend one primary flow and at most one follow-up experiment.
- Make consent, suppression, frequency, ownership, and failure handling visible when relevant.
- Never invent audience size, conversion rates, event coverage, or channel availability.
- If a Markdown file is useful, write it under `/outputs/marketing-automation-brief.md`, but always include the complete brief in the reply because sandbox files are temporary.
