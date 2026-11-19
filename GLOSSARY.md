# Cadence

A course platform where learners buy and take video courses, and instructors publish them.

## Language

### People

**Learner**:
A person who buys and takes courses.
_Avoid_: Student, user, buyer

**Admin**:
A Cadence staff member who runs the platform, including deciding Refund Requests.

### Refunds

**Refund Request**:
A Learner's ask to get their money back for a purchase, along with their reason. A purchase has at most one Open Refund Request at a time.
_Avoid_: Chargeback, Reversal, Cancellation, cancel my purchase

**Refund**:
The money returned to a Learner once an Admin approves their Refund Request. It is always the full Refund Amount, and it ends the Learner's access to that course.
_Avoid_: Reversal, Chargeback, partial refund

**Open**:
A Refund Request that is waiting for an Admin to approve or decline it.
_Avoid_: Pending, Requested

**Approved**:
A Refund Request an Admin has accepted. It produces a Refund.

**Declined**:
A Refund Request an Admin has turned down. No money is returned, but the Learner may raise a new Refund Request while the Refund Window lasts.

**Refund Window**:
The 14 whole calendar days after a purchase, starting on the purchase day.

**Refund Eligibility**:
Whether a Learner may raise a Refund Request. They may when the purchase is inside its Refund Window, is not a Claimed Team Seat, and the Learner has watched less than two hours of the course.

**Refund Amount**:
The money a Refund returns, which is always exactly what the Learner paid for the purchase.

**Claimed Team Seat**:
A seat from a team licence that a team member has taken up. It belongs to the team, so no Refund Request can be raised for it.

**Chargeback**:
A dispute a Learner raises with their bank or card issuer, outside Cadence. It is never a Refund Request.
