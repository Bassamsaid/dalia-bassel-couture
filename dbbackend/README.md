# Dalia Bassel Couture — real backend (Node.js, zero dependencies)
Start: npm start  (Node 22+). Default admin: admin@daliessa.com / daliessa123
Railway: runs `npm start` automatically.

## Keeping the data (read this before deploying)
Without a persistent disk the database lives inside the container and every
redeploy or restart throws it away — students, dresses, payments, the lot.
Attach a Volume mounted at /data and set `DATA_DIR=/data` and
`UPLOAD_DIR=/data/uploads`. Until that is in place, the only copy of the
studio's data is whatever has been downloaded from Configuration → Backup.

## Backups
In the app: Configuration → Backup, as an admin.
* **Download backup** — the SQLite database, exactly as the app has it.
* **Readable copy (JSON)** — every table as JSON, without password hashes.

Neither carries uploaded photos; those live in `UPLOAD_DIR`.

## Restoring
In the app: Configuration → Backup → **Restore from a backup file**, as an admin.
It takes either backup file and puts back only what is missing, so it is safe to
run onto an app that is not empty and safe to run twice. Restored accounts come
back without a password and need `reset-admin-password` before anyone can use
them. On a terminal the same thing is `npm run restore-backup -- <file>`.

To restore the database file itself instead, put the downloaded `.db` back as `$DATA_DIR/daliessa.db` with
the app stopped, and delete any `daliessa.db-wal` / `daliessa.db-shm` beside it
so the old write-ahead log is not replayed over the restored file.

### Backing up a version that predates the Backup screen
Signed in as an admin, open the browser console on the running app and paste:

    (async () => {
      const eps = ['users','dresses','purchases','vendors','expenses','expense-types',
        'payments','reminders','rounds','videos','homeworks','quizzes','notes',
        'settings','salaries','leaves','absences','advances','salary-payments','attendance'];
      const out = { exported_at: new Date().toISOString() };
      for (const e of eps) { try { const r = await fetch('/api/' + e); if (r.ok) out[e] = await r.json(); } catch (_) {} }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      a.download = 'daliessa-backup.json'; a.click();
    })()

It saves one file holding everything those endpoints return. Restore it with:

    node --experimental-sqlite restore-backup.js daliessa-backup.json

Rows whose id is already taken are skipped, so it is safe to run twice and safe
to run onto a database that has moved on; `--replace` overwrites them instead.
Passwords are in no backup, so restored accounts get an unusable placeholder and
need `reset-admin-password` before anyone can sign in. Uploaded photos are not
in a backup either.

## Maintenance scripts
Run these where the app runs, so they reach the same database it uses:

    npm run reset-admin-password -- '<new password>' [email]
    npm run delete-dresses                      # list, deletes nothing
    npm run delete-dresses -- --demo            # the seeded demo dress
    npm run delete-dresses -- --ids 3,7         # specific dresses
    npm run delete-dresses -- --all             # every dress
    npm run seed                                # replaces non-admin data with demo data

`--with-purchases` on delete-dresses also removes the material purchases, which
are otherwise kept on their invoices and only unlinked from the dress.
