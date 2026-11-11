# Strata architecture

This deployment uses Next.js App Router route handlers and PostgreSQL through Drizzle ORM. That is the supported runtime in this environment. Firebase Authentication, Firestore, Storage, and Cloud Functions are not connected.

Equivalent controls:

- Authentication: hashed passwords and httpOnly session cookies in `auth_sessions`.
- Authorization: role checks in `src/server/core.ts`. Company queries are scoped by the session company id, never by a client-supplied tenant id.
- Documents: private files under `storage/uploads`, served only by an authorized route.
- Bid integrity: server time, row locks, append-only bid rows, and invitation tokens.
- Email: Resend or SendGrid from the server. Demo addresses are suppressed.
- AI: Grok is called only from server code. If the key is absent, grounded workspace answers are used instead. Recommendations that introduce unknown figures are discarded.

Roles: Super Admin, Company Admin, Procurement Manager, Procurement Staff, Vendor.

AI demo vendors are labeled `SIMULATED / AI DEMO`, cannot be awarded, and are excluded from rankings shown to real suppliers.
