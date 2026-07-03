# Neon live-data migration — Builder 3

Review and back up the live Neon database before running this SQL. `api/init`
must be deployed and run first so the additive columns exist. The application
normalizes these legacy values at read time, so this migration is not required
for deployment and should not be run automatically.

```sql
BEGIN;

UPDATE users
SET status = 'active',
    updated_at = NOW()
WHERE status = 'approved';

UPDATE orders
SET status = CASE status
  WHEN 'approved'  THEN 'waiting_print'
  WHEN 'ready'     THEN 'ready_delivery'
  WHEN 'delivered' THEN 'completed'
  WHEN 'rejected'  THEN 'cancelled'
  ELSE status
END,
updated_at = NOW(),
completed_at = CASE
  WHEN status = 'delivered' THEN COALESCE(completed_at, NOW())
  ELSE completed_at
END,
cancellation_reason = CASE
  WHEN status = 'rejected' AND NULLIF(cancellation_reason, '') IS NULL
    THEN 'Migrated from legacy rejected status'
  ELSE cancellation_reason
END
WHERE status IN ('approved', 'ready', 'delivered', 'rejected');

-- Review the affected rows before committing.
SELECT id, name, status FROM users WHERE status = 'active';
SELECT id, status, cancellation_reason FROM orders
WHERE status IN ('waiting_print', 'ready_delivery', 'completed', 'cancelled');

COMMIT;
```

`rejected` maps to `cancelled`, because it represents a terminal refusal of the
order. Mapping it to `waiting_approval` would incorrectly reopen it and imply
that a price is awaiting friend approval. Replace `COMMIT` with `ROLLBACK` if
the review queries reveal unexpected rows.
