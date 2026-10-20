// A test-only ZIP reader (KAL-410). Walks the central directory from the end
// record, checks every local header against it, and checks each entry's
// CRC-32 with the CRC function the test passes in (Node's zlib.crc32), so
// the writer's own CRC code is never trusted.
export function readZip(bytes, crc32) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  if (p + cdSize !== eocd) throw new Error('central directory size does not match');
  const files = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central header ${i}`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    if (buf.readUInt32LE(local + 14) !== crc) throw new Error(`local CRC differs for ${name}`);
    const localNameLen = buf.readUInt16LE(local + 26);
    const localExtra = buf.readUInt16LE(local + 28);
    if (buf.subarray(local + 30, local + 30 + localNameLen).toString('utf8') !== name) throw new Error(`local name differs for ${name}`);
    const start = local + 30 + localNameLen + localExtra;
    const data = buf.subarray(start, start + size);
    if (method !== 0) throw new Error(`${name} is not stored`);
    if ((crc32(data) >>> 0) !== crc) throw new Error(`CRC mismatch for ${name}`);
    files.push({ name, data: new Uint8Array(data) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
