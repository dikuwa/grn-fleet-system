# External driver decision contract

This route records a Transport Office decision for a pending external-driver assignment.

- `accept` requires a supported confirmation method and revalidates the verified licence through the trip end date.
- `cancel` requires a reason and clears the request's assigned external driver so the request can be reallocated.
- The external person is never converted into an employee or user account.
- Staff-recorded acceptance is audit evidence of a communicated decision; it is not represented as self-service acknowledgement by the external person.
