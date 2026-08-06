---
name: email-sequence
description: Design and draft complete lifecycle email sequences with subject options, preview text, full copy, CTAs, timing, branching, exit conditions, suppression rules, and measurement handoffs. Use when a user needs an onboarding, nurture, re-engagement, win-back, launch, follow-up, educational, or upsell email series rather than a single message or an exact OpenEngage graph.
---

# Email Sequence

Turn one lifecycle outcome into a coherent series of complete, usable email drafts. Design every sequence even when OpenEngage cannot currently deliver it, but make the delivery boundary explicit.

## Evidence boundary

- Use only audience facts, offers, product claims, links, brand guidance, and performance data supplied in the conversation.
- Never invent testimonials, product capabilities, conversion rates, or universal performance benchmarks.
- Mark missing links, assets, approvals, template IDs, baselines, and targets as unresolved.
- Do not send email, create templates, call external platforms, or claim external research.

## Procedure

1. Confirm the sequence type, business outcome, audience and lifecycle state, entry signal, desired conversion, email count, cadence, voice, offer, CTA destinations, and available assets.
2. Read `references/sequence-blueprints.md` and choose the smallest sequence that can move the audience toward the outcome.
3. Define the narrative arc, the purpose of each email, escalation logic, conversion exit, re-entry rule, consent requirement, and suppression rules before drafting copy.
4. For every email, write two or three subject options, complementary preview text, purpose, complete body copy, one primary CTA, timing, recipient/skip conditions, and required personalization values.
5. Keep branches implementable. Route precise eligibility to `segment-designer` and exact node/edge compilation to `automation-flow-designer`.
6. Read `references/openengage-delivery-boundary.md`, classify every email, and assign one sequence-level capability state.
7. Route GA4 events, Key Events, UTM conventions, and QA requirements to `analytics-tracking`.
8. Use user-supplied historical performance as the baseline. Otherwise report baseline and target as `unknown` and name the data needed to set them.

## Output contract

Return:

1. Sequence decision: type, outcome, audience, entry, conversion exit, cadence, consent, suppression, and assumptions.
2. Overview table: order, purpose, subject, timing, CTA, recipient condition, and delivery classification.
3. Full email drafts with all required fields from the procedure.
4. Flow diagram and a concise list of branches, exits, re-entry, and failure/fallback behavior.
5. Measurement handoff: primary outcome, per-email signals, sequence-level signals, baseline/target status, and GA4 events requiring design.
6. OpenEngage handoff: required segments, templates, variables, resource IDs, and exact capability state.

Use exactly one capability state:

- `transactional-compatible`: every message is service- or account-related and can be represented by the current Transactional template model, subject to template publication and resource verification.
- `delivery-capability-blocked`: any message is promotional, lead nurture, launch, re-engagement, win-back, or upsell content that requires the disabled Marketing/Broadcast capability.

This is a product-capability classification, not legal advice. If a Markdown artifact helps, write it to `/outputs/email-sequence.md`, but include its complete contents in the reply because sandbox files are temporary.

## Attribution

Adapted for OpenEngage from Anthropic's `email-sequence` at commit `be1e436401efdaf12e523d8aa8218619b3b4748c`, licensed under Apache-2.0. Connector dependencies and unsupported benchmark claims were removed, and OpenEngage delivery constraints were added. See `LICENSE`.
