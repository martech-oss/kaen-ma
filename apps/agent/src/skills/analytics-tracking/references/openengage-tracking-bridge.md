# OpenEngage Tracking Bridge

GA4 is the primary plan. Add this appendix when the same signal should drive OpenEngage segmentation, automation, or reporting.

## Browser API

OpenEngage's generated site script exposes:

```js
window.openengage.consent();
window.openengage.identify("known-contact@example.com");
window.openengage.track("trial_activated", { plan: "pro" });
```

- Tracking records nothing until consent is explicitly granted.
- `identify(email)` associates future events with an existing active contact when the email matches. Keep this email out of GA4.
- `track(name, properties)` stores a `custom_event`; the supplied name becomes its resource ID.
- Automatic page tracking records `page_viewed` with URL, title, and referrer.
- The public endpoint accepts events only from allowed domains when an Origin header is present.

## Shared naming

- Use the GA4-compatible lowercase `snake_case` event name for both systems when semantics are identical.
- Keeping shared names within 40 characters also satisfies OpenEngage Automation event-name limits.
- Do not reuse a name when GA4 and OpenEngage triggers represent different semantic success points.
- Put non-PII context in properties and document allowed values.

## Product mapping

| Signal                                           | OpenEngage use                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `page_viewed`                                    | Site reporting and Automation decision checks                                                   |
| Browser `track(name)`                            | Contact timeline; `api_event` Automation source can match the same name for identified contacts |
| `form_submitted`                                 | Form reporting and Automation source/decision                                                   |
| `email_opened`, `email_clicked`, `email_replied` | Email and Automation reports or decision nodes                                                  |
| `segment_joined`                                 | Automation entry for an exact segment ID                                                        |

Only identified-contact events can enroll or advance contact-specific automations. Anonymous events still contribute to eligible site reporting but must not be presented as known-contact behavior.

## Reporting boundary

OpenEngage exposes Contact, Automation, Email, Deal, and Site reports. Map GA4 acquisition and journey analysis to GA4 first; use OpenEngage reports for operational contact, delivery, automation, form, page, and site-message outcomes. State cross-system reconciliation as unresolved unless the user supplies a shared identifier and reconciliation method.
