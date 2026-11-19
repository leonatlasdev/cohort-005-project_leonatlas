# Refund Eligibility uses watch time, not lesson completion

Refund Eligibility limits how much of a course a Learner can have consumed by **watch time**: less than two hours of video, counted as the furthest point reached in each lesson. It does not look at how many lessons they have marked complete. The course page used to also hide the refund form once 50% of lessons were completed, but the server never enforced that, so the two disagreed. We dropped the completion rule rather than adding it to the server. Marking a lesson complete is one click and says little about what was actually watched, while watch time measures it directly.

## Consequences

- Eligibility lives in one place (`app/lib/refunds.server.ts`), used by both the course page and the refund action, so they cannot drift apart again.
- Do not reintroduce a completion-based rule without revisiting this decision.
