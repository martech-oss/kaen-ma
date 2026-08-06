# Sequence Blueprints

Use these as starting shapes, not fixed prescriptions. Shorten or extend only when the supplied audience, risk, and expected decision delay justify it.

| Type              | Starting shape              | Typical arc                                                           |
| ----------------- | --------------------------- | --------------------------------------------------------------------- |
| Onboarding        | 3–7 messages over 1–3 weeks | Welcome → first value → core behavior → next milestone                |
| Lead nurture      | 3–6 messages over 2–4 weeks | Useful insight → problem clarity → solution proof → direct next step  |
| Re-engagement     | 2–4 messages over 1–2 weeks | Relevant reason to return → missed value → final choice               |
| Win-back          | 3–5 messages over 2–4 weeks | Check-in → what changed → return offer or feedback → respectful close |
| Product launch    | 3–6 messages around launch  | Context → announcement → use case/proof → reminder                    |
| Event follow-up   | 2–4 messages over 1–2 weeks | Takeaways → resources → relevant next action → feedback               |
| Upgrade or upsell | 2–5 messages over 1–3 weeks | Success signal → unmet need → benefit/proof → upgrade decision        |
| Educational drip  | 4–8 messages over 3–6 weeks | Orientation → sequenced lessons → application → completion/next step  |

## Drafting rules

- Give the sequence one narrative arc and each email one job.
- Prefer one primary CTA. Add a secondary CTA only when it does not compete with the intended decision.
- Make preview text add information rather than repeat the subject.
- Keep body copy skimmable and claims traceable to user-provided evidence.
- Use named placeholders such as `{{first_name}}` only when the required data source is known; otherwise list the variable as unresolved.
- Specify delays relative to the entry or previous email and explain behavior-dependent timing changes.
- Define the observable event or field behind every branch and exit. If the signal does not exist, mark the branch unresolved rather than inventing it.
- Treat unsubscribes, suppressions, complaints, delivery failures, and missing events as first-class outcomes.

## Measurement rules

- Select one outcome metric and one early signal.
- Define the event and parameters that prove each metric.
- Use measured historical values only when the user supplies them.
- When no baseline exists, set `baseline: unknown`, `target: unknown`, and specify the first measurement window.
- Do not reuse generic open/click/conversion benchmarks as if they applied to the user's audience.
