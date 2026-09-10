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

To restore, put the downloaded `.db` file back as `$DATA_DIR/daliessa.db` with
the app stopped, and delete any `daliessa.db-wal` / `daliessa.db-shm` beside it
so the old write-ahead log is not replayed over the restored file.

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
