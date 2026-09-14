'use strict';
// Reset an admin's password. Run it wherever the app runs, so it hits the same
// database the server does (DATA_DIR is resolved by db.js, volume included):
//   node --experimental-sqlite reset-admin-password.js '<new password>' [email]
// The password is never written to this repo — it is passed in at run time.
const { db, ready, hashPassword } = require('./db');

const pw = process.argv[2] || process.env.NEW_PASSWORD;
const email = process.argv[3];

if (!pw) {
  console.error("usage: node --experimental-sqlite reset-admin-password.js '<new password>' [email]");
  process.exit(1);
}
if (String(pw).length < 10) {
  console.error('Password too short — use at least 10 characters.');
  process.exit(1);
}

// Without an email: only safe when there is exactly one admin, otherwise we'd be
// guessing which account to lock the owner out of.
const admins = email
  ? await db.prepare("SELECT id, name, email FROM users WHERE email = ? AND role = 'admin'").all(email)
  : await db.prepare("SELECT id, name, email FROM users WHERE role = 'admin'").all();

if (admins.length === 0) {
  console.error(email ? `No admin found with email ${email}` : 'No admin account found.');
  process.exit(1);
}
if (admins.length > 1) {
  console.error('More than one admin — pass the email of the one to reset:');
  for (const a of admins) console.error(`  ${a.email}  (${a.name})`);
  process.exit(1);
}

const admin = admins[0];
await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), admin.id);
console.log(`Password updated for ${admin.email} (${admin.name}). Sign in with the new one.`);
