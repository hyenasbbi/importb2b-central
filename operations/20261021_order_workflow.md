# Catalog order and operational notifications

Order states: pending request -> accepted/reserved -> confirmed sale -> completed delivery.
Cancellation is allowed before a sale. Acceptance reuses historical reservations;
canceling a pending request releases only its actual outstanding reservation.
Sale conversion remains the existing transactional stock/finance implementation.
No live order is accepted, cancelled, sold or delivered by this deployment.

Both catalog submission routes now call the same transactional database function.
After saving, the catalog opens WhatsApp with authoritative order item prices,
customer, delivery and payment details. Opening a draft does not send a message.
Admin cards/detail include customer WhatsApp links, separate action buttons and
a blue reserved-order border. Completed delivery is a separate post-sale action.

Every new order and distinct tracking event creates an inbox entry for each
profile with role admin, plus a private push outbox entry. Global badge counts
refresh immediately on entry and every 30 seconds while the app is visible.
Web order counts include pending and accepted orders. Inbox entries open the
relevant order/tracking section and are individually marked as read.

The push worker is protected by the existing cron secret. Private queue access
is denied to clients; claim/finish RPCs are service-role-only. Device successes
are retained across retries to avoid resending successful pushes. Failed jobs
retry after five minutes, up to five attempts; status codes contain no keys.
An async database wake dispatches new events promptly; a one-minute cron is the
fallback. Open orders older than 24 hours produce one follow-up per admin/order.
Resolved orders are skipped if they close before their queued push is sent.

17TRACK webhook events and authenticated refreshes use the same event trigger.
The refresh endpoint also permits the existing service-role credential for a
15-minute scheduled poll of registered, unreceived shipments. Repeated provider
events are ignored using the existing shipment/provider-event unique constraint.
No periodic notice is created for unchanged tracking. Existing provider parsing
and registration are preserved; the old direct notification calls are disabled.

Validation: tests/operational-orders.sql runs fixtures inside ROLLBACK: no reserve
on creation, idempotent acceptance, sale stock debit, delivery without duplicate
sale, cancellation with/without reservations, one inbox per admin/event.
tests/order-notifications.mjs covers phone/message formatting, UI actions,
TypeScript parsing and worker authentication. Existing push and catalog tests pass.
The private outbox intentionally has no client RLS policy; service-only access
is enforced by schema/table revocations and restricted definer RPC grants.
