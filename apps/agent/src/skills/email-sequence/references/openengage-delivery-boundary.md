# OpenEngage Email Delivery Boundary

Read this reference before assigning a capability state or producing an OpenEngage handoff.

## Current capability

- OpenEngage email templates have `purpose: transactional`.
- An Automation `send_email` action references `templateId` and may include `topicId`.
- Publishing verifies that referenced email templates are published, unarchived, and Transactional.
- Marketing Campaign/Broadcast delivery is disabled. A structurally sound marketing sequence is therefore still not executable.

## Classification

Classify each email by its actual purpose, not by the sequence label.

- Treat requested account/service fulfillment, security, operational status, and product-use guidance directly tied to an active service relationship as candidates for `transactional-compatible`.
- Treat promotions, lead nurture, product announcements, re-engagement, win-back, cross-sell, and upsell as Marketing delivery and therefore blocked.
- Onboarding may contain both kinds. If any message requires Marketing delivery, set the whole sequence to `delivery-capability-blocked` and identify the affected messages.
- Do not make a legal compliance determination. Require the operator to confirm consent, purpose, and jurisdictional requirements.

## Handoff

For every email list:

- proposed template name and unresolved `templateId`;
- subject and complete copy;
- required message variables and their data source;
- publication and archive status as unresolved unless supplied;
- consent topic or suppression requirement when relevant;
- CTA destination and tracking parameters;
- corresponding Automation action, delay, branch, and exit signal.

Activate `automation-flow-designer` only after the content, timing, and branches are stable. Its validator proves schema and graph structure, not template existence or deliverability.
