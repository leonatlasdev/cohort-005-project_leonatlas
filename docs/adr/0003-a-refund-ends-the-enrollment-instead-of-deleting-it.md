# A Refund ends the Enrollment instead of deleting it

An approved Refund turns the Learner's Enrollment into an **Ended Enrollment**: it stays in the database but no longer gives access. The obvious alternative is to delete the enrollment row, since access is currently "an enrollment row exists". We rejected it because deletion is irreversible. It would destroy the Learner's progress and quiz history, erase the record that they were ever enrolled, and give a Learner who buys the course again a blank slate. With an Ended Enrollment, progress carries over to a new purchase, and any later enrollment history can see that the Refund happened.

## Consequences

- Every access and enrollment check must treat an Ended Enrollment as "not enrolled". Code that only asks "does an enrollment row exist?" is wrong after this change. That includes `getAccess`, the course page, the purchase flow's "already enrolled" guard, seat redemption, and enrollment counts.
- Buying the course again revives access with a new purchase and its own Refund Window, rather than creating a second, parallel enrollment.
