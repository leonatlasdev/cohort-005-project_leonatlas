# Cadence

A course platform where learners buy and take video courses, and instructors publish them.

## Language

### People

**Learner**:
A person who buys and takes courses.
_Avoid_: Student, user, buyer

**Platform Admin**:
A Cadence staff member who runs the platform, including deciding Refund Requests.
_Avoid_: Admin, reviewer

**Team Admin**:
The member of a team who buys and manages its seats.
_Avoid_: Admin

**Course Staff**:
The people who speak for a course: its Instructor and any Platform Admin.

### Enrollment

**Enrollment**:
A Learner's access to a course, which starts when they buy it or claim a team seat.

**Ended Enrollment**:
An Enrollment that no longer gives access because its purchase was Refunded. The Learner's progress is kept, and they can buy the course again.
_Avoid_: Revoked, deleted, unenrolled

### Refunds

**Refund Request**:
A Learner's ask to get their money back for a purchase, along with their reason. A purchase has at most one Open Refund Request at a time.
_Avoid_: Chargeback, Reversal, Cancellation, cancel my purchase

**Refund**:
The money returned to a Learner once a Platform Admin approves their Refund Request. It is always the full Refund Amount, and it turns the Learner's Enrollment into an Ended Enrollment.
_Avoid_: Reversal, Chargeback, partial refund

**Open**:
A Refund Request that is waiting for a Platform Admin to approve or decline it. The Learner keeps their Enrollment while it is Open.
_Avoid_: Pending, Requested

**Approved**:
A Refund Request a Platform Admin has accepted. It produces a Refund.

**Declined**:
A Refund Request a Platform Admin has turned down, always with a Decision Note. No money is returned, but the Learner may raise a new Refund Request while the Refund Window lasts.

**Refund Window**:
The 14 whole calendar days after a purchase, starting on the purchase day. Every purchase has its own, including one made after an earlier Refund.

**Refund Eligibility**:
Whether a Learner may raise a Refund Request. They may when the purchase is inside its Refund Window, is not a Team Purchase with a Claimed Team Seat, and the Learner has watched less than two hours of the course. It is judged only when the Refund Request is raised, never when a Platform Admin decides it.

**Refund Amount**:
The money a Refund returns, which is always exactly what the Learner paid for the purchase.

**Decision Note**:
A Platform Admin's message to the Learner explaining why a Refund Request was approved or declined. Every Decline has one.

**Chargeback**:
A dispute a Learner raises with their bank or card issuer, outside Cadence. It is never a Refund Request.

### Teams

**Team Purchase**:
A single purchase of several seats for a course, made by a Team Admin. It can be refunded in full only while none of its seats is claimed, and a Refund voids every unclaimed seat.

**Claimed Team Seat**:
A seat from a Team Purchase that a team member has taken up. Once any seat is claimed, no Refund Request can be raised for that Team Purchase.
