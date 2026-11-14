# Smart Business Supabase project

The Smart Business V1.383 app uses the hosted project. The
`business_records` table keeps full business records owner-only. The
`team_debt_records` table shares customer debts with members of the owner's
team workspace; employees can read the debt and payment status, but only an
owner can publish changes.

The project's public publishable key is configured in `collaboration.js`.
It is a client-safe key; database access relies on the migration's
row-level-security policies and Supabase Auth. Never add a service-role or
secret key to browser code.

## Sync debts to employee accounts

1. Apply `supabase/migrations/20261113000000_employee_debt_sync.sql` to the
   linked project. It relies on the existing `team_members` workspace table
   used by the app's cloud employee access-code flow.
2. Sign in as Admin / Owner and connect the owner account to the team cloud
   workspace from **Employee notes**. If needed, create the cloud workspace.
3. Use **Create employee access code** and share the code with each employee.
   The employee signs up for a cloud account with their own email and password
   and joins that workspace with the code.
4. Once connected, owner edits, payments, and deletions are published to the
   workspace. Employee accounts see the latest debt and paid status when
   online; their debt view is read-only. Their local sales and other records
   remain separate.

The employee membership is enforced by row-level security: workspace members
can read the snapshot, while only an Admin / Owner member can write it. The
employee's cloud account must match their Employee / Agent app account.

## Use the connected app

1. Publish the app files from this archive to the same HTTPS website address
   used by the existing Smart Business app.
2. Ensure **Authentication → Providers → Confirm email** remains disabled.
   The app derives a non-routable synthetic email from each owner username.
3. On the first device, create an Admin / Owner account using the intended
   username and a unique private password/access code. If a cloud row does not
   exist yet, local business records are uploaded during first setup.
4. On other owner devices, use the same URL, Admin / Owner role, username, and
   password/access code to load the shared records.
5. To share customer debts with employees, follow **Sync debts to employee
   accounts** above. Owner cloud sign-in and employee workspace membership are
   separate; do not share the owner's password with employees.

On a phone, open the same app URL and sign in with the same Admin / Owner
username and password/access code. Google sign-in is not required.

Treat the owner password as a reusable access code: anyone holding it and the
username can access the business data. Keep backups and avoid simultaneous
editing on multiple devices. The app reports detected edit conflicts rather
than silently overwriting cloud data.

## Deploy to a hosted Supabase project

1. Create a Supabase account and project at <https://supabase.com/>.
2. Install the Supabase CLI, then open a terminal in the folder containing
   `supabase/`.
3. Sign in and link the hosted project:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

4. Apply the database migration:

   ```powershell
   supabase db push
   ```

5. In Supabase **Authentication → Providers → Email**, disable email
   confirmations. The app generates private, non-routable email addresses from
   the owner's username; there is no inbox to verify.
6. Copy the project URL and public anon/publishable key from the Supabase
   project API settings into `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top
   of the app's `collaboration.js`. These values are public. Never put a
   service-role or secret key in browser code.
7. Publish the entire app folder to its existing HTTPS website.

The app's reusable owner code is the owner's cloud password: the owner enters
their username and the same code in the password field on every device. Use a
unique code of at least 12 characters and keep it private. Anyone with the
username and code can access that owner's cloud records.

On the first cloud account creation, existing local records are uploaded only
when no cloud record exists yet. Subsequent devices signing in to that account
load the cloud record. Keep a separate backup before connecting devices.

## Local Supabase development

With Docker and the Supabase CLI installed, start the local services:

```powershell
supabase start
supabase status
```

Local development credentials and database data are separate from the hosted
project. To publish database changes, link a hosted project and run
`supabase db push`.

## Security

The migrations enable row-level security. Owner business records are restricted
to the matching owner account. Shared employee debt snapshots are readable by
workspace members and writable only by workspace owners. The debt migration
expects the existing `team_members` table to be present in the linked project.
Keep the public anon key only in the client; do not expose service-role keys.
This project scaffold does not create a hosted Supabase account or project.
