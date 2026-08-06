---
name: customer-journey-map
description: Create an end-to-end customer journey map with stages, touchpoints, actions, emotions, pain points, and prioritized opportunities. Use when a user needs to understand experience gaps, onboarding friction, moments of truth, or churn risks before designing an automation.
license: MIT
compatibility: Adapted for the OpenEngage Flue agent. Uses only context provided in the conversation and returns the complete Markdown artifact in the reply.
metadata:
  source: https://github.com/phuryn/pm-skills/blob/18468a95b427e70e258b51389796367c6f684e7d/pm-market-research/skills/customer-journey-map/SKILL.md
  source-commit: 18468a95b427e70e258b51389796367c6f684e7d
  modified: "true"
---

# Customer Journey Map

Map the experience of one specific persona across the stages that matter for the requested product or service. The goal is to expose consequential friction and identify the smallest useful improvements.

## Evidence boundary

- Read and use research, analytics, support evidence, or existing maps supplied by the user.
- Do not claim to have researched a URL or external source.
- Separate observed evidence from assumptions.
- If the persona or journey goal is missing, choose a reasonable working assumption and make it explicit.

## Procedure

1. Define the persona with situation, job to be done, desired outcome, and relevant constraints.
2. Adapt the journey stages to the case. Start with awareness, consideration, acquisition, onboarding, engagement, retention, and advocacy, then remove or rename stages that do not fit.
3. For every stage, capture the main touchpoint, customer action, question or expectation, emotion, pain point, and opportunity.
4. Identify the first-value or Aha moment, major moments of truth, likely abandonment points, and churn triggers.
5. Prioritize opportunities by customer impact, business impact, confidence in the evidence, and implementation effort.
6. Recommend up to three improvements: one quick validation, one near-term intervention, and one larger investment only when justified.

## Output format

```markdown
# Customer Journey Map

## Persona and journey goal

- Persona:
- Job to be done:
- Desired outcome:
- Evidence used:
- Assumptions:

## Journey

| Stage | Touchpoint | Customer action | Question or expectation | Emotion | Pain point | Opportunity |
| ----- | ---------- | --------------- | ----------------------- | ------- | ---------- | ----------- |

## Critical moments

- First-value or Aha moment:
- Moments of truth:
- Abandonment or churn triggers:

## Prioritized improvements

| Priority | Improvement | Evidence | Expected impact | Effort | Owner |
| -------- | ----------- | -------- | --------------- | ------ | ----- |

## Recommended next step

- The single next action and what would validate it.
```

Keep the journey internally consistent: actions, emotions, pain points, and opportunities must describe the same persona and stage. Do not fabricate quantitative evidence.

Activate `segment-designer` when a prioritized journey opportunity needs precise audience eligibility, exclusions, consent handling, or OpenEngage SegmentFilter JSON.

Activate `email-sequence` when the selected journey improvement is a multi-message lifecycle intervention. Activate `analytics-tracking` when a critical moment needs an implementable GA4 event and QA plan.

If a Markdown file is useful, write it to `/outputs/customer-journey-map.md`, but always include the complete map in the reply because sandbox files are temporary.
