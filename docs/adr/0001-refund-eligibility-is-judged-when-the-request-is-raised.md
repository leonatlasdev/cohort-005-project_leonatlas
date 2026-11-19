# Refund Eligibility is judged when the Refund Request is raised

Refund Eligibility is checked once, when the Learner raises a Refund Request. It is never checked again when a Platform Admin approves or declines. A request can sit Open past the end of the Refund Window, or while the Learner watches past the two-hour limit (they keep their Enrollment while it is Open). A re-check at decision time would turn a slow review into a Decline the Learner did nothing to earn. The Platform Admin's judgement, recorded in a Decision Note, is the safeguard against abuse instead.

## Consequences

- Do not add an eligibility check to the approve path. The missing check is deliberate.
- Because seats could otherwise be claimed during review, seats on a Team Purchase cannot be claimed while it has an Open Refund Request (see ADR-0004).
