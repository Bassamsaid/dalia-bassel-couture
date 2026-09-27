'use strict';
// A zip writer, because the photos need to leave in one piece.
//
// The database backup carries filenames, not photos — the files themselves sit
// in UPLOAD_DIR, and on hosting that is about to be switched off they are the
// one thing a JSON file cannot bring back. This packs them into a single
// download with nothing installed: the format below is the 1989 one, stored
// (uncompressed), which is all a folder of JPEGs would get from deflate anyway.
//
// Entries are streamed out one at a time — each file is read, written, and let
// go — so the size of the archive is not the size of the memory it takes.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Zip keeps time the way DOS did: seconds in steps of two, years from 1980.
function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const UTF8_NAMES = 0x0800; // tells the reader the name below is UTF-8
const STORED = 0;

function localHeader(name, crc, size, { time, date }) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(LOCAL_SIG, 0);
  h.writeUInt16LE(20, 4);           // version needed
  h.writeUInt16LE(UTF8_NAMES, 6);
  h.writeUInt16LE(STORED, 8);
  h.writeUInt16LE(time, 10);
  h.writeUInt16LE(date, 12);
  h.writeUInt32LE(crc >>> 0, 14);
  h.writeUInt32LE(size, 18);        // compressed
  h.writeUInt32LE(size, 22);        // uncompressed — the same, stored
  h.writeUInt16LE(name.length, 26);
  h.writeUInt16LE(0, 28);           // no extra field
  return Buffer.concat([h, name]);
}

function centralHeader(name, crc, size, { time, date }, offset) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(CENTRAL_SIG, 0);
  h.writeUInt16LE(20, 4);           // version made by
  h.writeUInt16LE(20, 6);           // version needed
  h.writeUInt16LE(UTF8_NAMES, 8);
  h.writeUInt16LE(STORED, 10);
  h.writeUInt16LE(time, 12);
  h.writeUInt16LE(date, 14);
  h.writeUInt32LE(crc >>> 0, 16);
  h.writeUInt32LE(size, 20);
  h.writeUInt32LE(size, 24);
  h.writeUInt16LE(name.length, 28);
  h.writeUInt16LE(0, 30);           // extra
  h.writeUInt16LE(0, 32);           // comment
  h.writeUInt16LE(0, 34);           // disk number
  h.writeUInt16LE(0, 36);           // internal attributes
  h.writeUInt32LE(0, 38);           // external attributes
  h.writeUInt32LE(offset, 42);      // where its local header starts
  return Buffer.concat([h, name]);
}

function endRecord(count, size, offset) {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(END_SIG, 0);
  h.writeUInt16LE(0, 4);            // this disk
  h.writeUInt16LE(0, 6);            // disk the directory starts on
  h.writeUInt16LE(count, 8);
  h.writeUInt16LE(count, 10);
  h.writeUInt32LE(size, 12);
  h.writeUInt32LE(offset, 16);
  h.writeUInt16LE(0, 20);           // no archive comment
  return h;
}

// Write `files` (absolute paths) into `out` as a zip, named by their basename.
// A file that has gone missing since it was listed is skipped rather than
// failing the whole download.
async function writeZip(out, files) {
  const central = [];
  let offset = 0;
  let written = 0;
  // One listener for the whole archive, not one per chunk: a browser that walks
  // away mid-download would otherwise pile up thousands of them.
  let failed = null;
  const onError = (e) => { failed = e; };
  out.on('error', onError);
  const push = (buf) => new Promise((res, rej) => {
    if (failed) return rej(failed);
    offset += buf.length;
    if (out.write(buf)) return res();
    out.once('drain', res);
  });

  for (const file of files) {
    let body;
    try { body = fs.readFileSync(file); } catch (e) { continue; }
    let stamp;
    try { stamp = dosTime(fs.statSync(file).mtime); } catch (e) { stamp = dosTime(new Date()); }
    const name = Buffer.from(path.basename(file), 'utf8');
    const crc = zlib.crc32(body);
    const at = offset;
    await push(localHeader(name, crc, body.length, stamp));
    await push(body);
    central.push(centralHeader(name, crc, body.length, stamp, at));
    written++;
  }

  const dirAt = offset;
  for (const h of central) await push(h);
  await push(endRecord(written, offset - dirAt, dirAt));
  out.removeListener('error', onError);
  out.end();
  return written;
}

module.exports = { writeZip };
