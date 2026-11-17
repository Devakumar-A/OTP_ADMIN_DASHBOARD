# Starlight Hotels Admin Dashboard (read-only)

Separate Vite + React + TypeScript app that reads your existing Supabase project. It does not touch the receptionist or hotel apps, and it never writes to the database.

## Run it
1. Open `.env` and replace only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (anon key, never the service_role key).
2. `npm install`
3. `npm run dev` (or `npm run build` and host the `dist` folder).
4. Sign in with your admin Supabase user (email + password).

## Production safety
- **Write guard:** `src/lib/supabase.ts` rejects any non-GET/HEAD request to the data API in the browser. Insert, update, upsert and delete cannot leave the app.
- **No RPC, no service key, no storage, no `otp_hash`, no ID-proof or address columns** anywhere in `src/`. Check with `npm run check:readonly`.
- **RLS is respected.** The app uses the signed-in user's own session. If RLS hides hotels from that user, a banner says so; nothing is bypassed.
- Phone numbers are masked in lists and in every export (a "Show phone numbers" switch exists on the two guest tables).
- Tests: `npm test` (finance maths, IST dates, masking, write guard, paging).

## Access
Optional `VITE_ADMIN_EMAILS` (comma separated) limits who can open the dashboard. This is a convenience only; the real boundary is your RLS policies. Accounts found in the `receptionists` table are refused unless listed there.
If the admin user gets "no hotels visible", an existing SELECT policy for that user is needed. This app will not create or change policies.

## Time
All dates, presets ("Today", "This month"…) and charts use Asia/Kolkata (IST). Your columns are `timestamptz`, so values are stored in UTC and converted for display and filtering.

## Revenue rules (important)
- **Booked** = stay total (`total_amount`, falling back to `amount`) + extension amount.
- **Collected** = stay `amount_paid` + extension `amount_paid`.
- **Outstanding** = stored `balance_amount` values (stays + extensions).
- If your data shows `total_amount` already includes extension charges (Phase 1 query 9), set `VITE_EXTENSIONS_INCLUDED_IN_TOTAL=true` so extensions are not added twice.
- Payment mode chart: the four split columns are used when any is non-zero, otherwise `amount_paid` goes to the stay's `payment_mode`. Never both.
- The Revenue page lists data-quality findings (balance mismatches, split ≠ paid) instead of hiding them.

## Statuses
`src/config.ts → STATUS` maps database values to Verified / Pending / Failed / Expired and Active / Checked-out / Cancelled. Unmapped values are shown raw with a notice. After running Phase 1 query 7, add your real values there.

## Performance
Lists are paginated and filtered server-side (25 rows/page, explicit columns). Aggregates read a few narrow numeric columns in 1,000-row pages (about 18 requests for 17k stays), cached for 5 minutes. Today's counts use head-only COUNT queries.

## Known limits
- Guest-level filters (name, phone, GRC) apply to stays, verifications and follow-ups, not to extensions (no verified join key was needed; extensions are filtered by hotel, date, receptionist, payment status and booking ID).
- Receptionist revenue follows the stay's receptionist.
