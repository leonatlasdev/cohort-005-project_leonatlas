# Team Purchases are refunded all-or-nothing

A Team Purchase is one purchase covering several seats. It can be refunded only in full, and only while none of its seats has been claimed. An approved Refund voids every unclaimed seat, and seats cannot be claimed while the Team Purchase has an Open Refund Request. We considered refunding seat by seat, or refunding only the unclaimed seats, but rejected both. Either would mean a partial Refund (the Refund Amount is always exactly what was paid), and seats would need prices of their own. That is a bigger model than teams currently need. Without voiding and the claim freeze, a Team Admin could get the money back while seat codes kept granting access.

## Consequences

- Seat redemption must reject a seat that is voided or whose Team Purchase has an Open Refund Request.
- If per-seat refunds are ever wanted, this ADR and the "no partial refunds" rule in `GLOSSARY.md` have to be revisited together.
