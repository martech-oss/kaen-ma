# GA4 Tracking Plan Reference

Use this reference for GA4-first event design. Confirm mutable GA4 administration details against current official documentation before implementation.

## Event design

- Prefer automatically collected, enhanced-measurement, or recommended GA4 events when their defined semantics match.
- Create a custom event only for a business action not represented by an appropriate recommended event.
- Keep event names lowercase `snake_case`, verb-first, and at most 40 characters.
- Track meaningful outcomes and diagnostic steps, not every DOM interaction.
- Define parameter names, value types, allowed values, source, and null behavior.
- Include an application event ID or other stable dedupe value when duplicate delivery is possible.

Example catalog row:

| Event           | Trigger               | Parameters                     | Identity                    | Key Event | Dedupe    | Owner              |
| --------------- | --------------------- | ------------------------------ | --------------------------- | --------- | --------- | ------------------ |
| `submit_signup` | Server accepts signup | `method:string`, `plan:string` | anonymous or opaque User ID | Yes       | signup ID | Growth engineering |

## Identity and privacy

- Set GA4 User ID only after authentication and use an opaque internal identifier.
- Do not send email, name, phone, street address, or other direct PII in event names, parameters, page URLs, or User ID.
- Document how anonymous activity relates to authenticated activity without promising unsupported identity stitching.
- Gate analytics according to the supplied consent policy and consent-management platform.

## Key Events and attribution

- Mark only actions that represent material business outcomes as Key Events.
- Tie every Key Event to a business question, owner, and expected downstream report.
- Define UTM source, medium, campaign, content, and term conventions before campaign launch; use controlled lowercase values.
- State the attribution model as an assumption unless the user supplies the configured model.
- Avoid claiming causal impact from attributed conversions alone.

## Implementation

For gtag, provide event pseudocode with named parameters:

```js
gtag("event", "submit_signup", {
  method: "email",
  plan: "trial",
  event_id: "opaque-dedupe-id",
});
```

For GTM, specify the data-layer event, variables, trigger, GA4 Event tag, consent requirements, and environments. Do not invent selectors or data-layer paths that were not supplied.

## QA

- Validate consent-denied and consent-granted paths separately.
- Confirm the event fires once at the semantic success point, not merely on a button click.
- Verify event name, parameter names/types, User ID state, UTM persistence, and dedupe behavior.
- Use the supplied stack's preview tools plus GA4 Realtime and DebugView.
- Test anonymous, authenticated, retry, validation-error, duplicate-submit, and cross-domain cases when relevant.
- Record expected evidence and an owner for every failed check.
