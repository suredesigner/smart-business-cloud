# Smart Business Supabase project

The Smart Business V1.381 app is configured for the hosted project. The
`business_records` table, owner-only row-level security policies, and
updated-at trigger are installed. Employee accounts are not synchronized.

The project's public publishable key is configured in `collaboration.js`.
It is a client-safe key; database access relies on the migration's
row-level-security policies and Supabase Auth. Never add a service-role or
secret key to browser code.

## Use the connected app

1. Publish the app files from this archive to the same HTTPS website address
   used by the existing Smart Business app.
2. Ensure **Authentication → Providers → Confirm email** remains disabled.
   The app derives a non-routable synthetic email from each owner username.
3. On the first device, create an Admin / Owner account using the intended
   username and a unique private password/access code. If a cloud row does not
   exist yet, local business records are uploaded during first setup.
4. On all other devices, use the same URL, Admin / Owner role, username, and
   password/access code to load the shared records.

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

The app's reusable boss code is the owner's cloud password: the owner enters
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

The migration enables row-level security and allows an authenticated user to
read or change only the row whose `user_id` matches their Supabase user ID.
Keep the public anon key only in the client; do not expose service-role keys.
This project scaffold does not create a hosted Supabase account or project.
