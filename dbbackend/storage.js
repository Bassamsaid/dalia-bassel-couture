'use strict';
// Where a photo or a video actually lives.
//
// Serverless gives a function no disk that outlasts the request, so on Vercel
// the files go to Blob storage and the database keeps the URL it hands back. On
// a host with a real disk — and in development — nothing changes: the file is
// written to UPLOAD_DIR and the database keeps the filename, exactly as before.
//
// Both kinds of value live side by side in the same column, so an install that
// moves from one to the other keeps serving everything it already had.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!BLOB) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_OK = { mp4: '.mp4', mov: '.mov', webm: '.webm', jpg: '.jpg', jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif' };
const MIME = {
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

const newName = (ext) => `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;

// A stored value is either a filename from the disk era or a full URL from Blob.
const isUrl = (v) => /^https?:\/\//i.test(String(v || ''));

// Resolve a filename to a path, confined to UPLOAD_DIR so a stored value can
// never reach outside it.
function diskPath(stored) {
  const name = path.basename(String(stored || '').replace(/^\/?uploads\//, ''));
  if (!name || name === '.' || name === '..') return null;
  const full = path.resolve(UPLOAD_DIR, name);
  return full.startsWith(path.resolve(UPLOAD_DIR) + path.sep) ? full : null;
}

// Save bytes; returns what to store in the database.
async function save(buf, ext) {
  const name = newName(ext);
  if (!BLOB) { fs.writeFileSync(path.join(UPLOAD_DIR, name), buf); return name; }
  const { put } = require('@vercel/blob');
  const r = await put(name, buf, { access: 'public', contentType: MIME[ext] || 'application/octet-stream' });
  return r.url;
}

// Save a request body without holding it in memory — a fitting video is tens of
// megabytes, and Blob takes the stream straight through.
async function saveStream(stream, ext) {
  const name = newName(ext);
  if (!BLOB) {
    await new Promise((res, rej) => {
      const out = fs.createWriteStream(path.join(UPLOAD_DIR, name));
      stream.pipe(out); out.on('close', res); out.on('error', rej); stream.on('error', rej);
    });
    return name;
  }
  const { put } = require('@vercel/blob');
  const r = await put(name, stream, { access: 'public', contentType: MIME[ext] || 'application/octet-stream' });
  return r.url;
}

async function remove(stored) {
  if (!stored) return false;
  if (isUrl(stored)) {
    try { const { del } = require('@vercel/blob'); await del(String(stored)); return true; }
    catch (e) { return false; }
  }
  const p = diskPath(stored);
  if (!p) return false;
  try { fs.unlinkSync(p); return true; } catch (e) { return false; }
}

module.exports = { BLOB, UPLOAD_DIR, EXT_OK, MIME, isUrl, diskPath, save, saveStream, remove };
