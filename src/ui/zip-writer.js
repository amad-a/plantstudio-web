// A minimal zip writer. Files are stored as they are, without compression (it's meant
// for PNG frames, which are compressed already), and bytes are handed to `write` as
// each file is added, so a long recording can stream straight to disk. No zip64, so
// the whole archive has to stay under 4 GB.

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const LIMIT = 0xffffffff;
const UTF8_NAMES = 0x0800;

export class ZipWriter {
  // write(Uint8Array) may return a promise; it's awaited before the next write.
  constructor(write) {
    this.write = write;
    this.offset = 0;
    this.entries = [];
    const now = new Date();
    this.time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    this.date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  }

  async add(name, data) {
    const nameBytes = new TextEncoder().encode(name);
    if (this.offset + 30 + nameBytes.length + data.length + 46 * (this.entries.length + 1) > LIMIT) {
      throw new Error('The recording is too big for a zip file (4 GB). Try a smaller size or fewer days.');
    }
    const crc = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, UTF8_NAMES, true);
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, this.time, true);
    header.setUint16(12, this.date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);
    await this.write(new Uint8Array(header.buffer));
    await this.write(nameBytes);
    await this.write(data);
    this.entries.push({ nameBytes, crc, size: data.length, offset: this.offset });
    this.offset += 30 + nameBytes.length + data.length;
  }

  async finish() {
    const start = this.offset;
    for (const entry of this.entries) {
      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true);
      record.setUint16(4, 20, true);
      record.setUint16(6, 20, true);
      record.setUint16(8, UTF8_NAMES, true);
      record.setUint16(10, 0, true);
      record.setUint16(12, this.time, true);
      record.setUint16(14, this.date, true);
      record.setUint32(16, entry.crc, true);
      record.setUint32(20, entry.size, true);
      record.setUint32(24, entry.size, true);
      record.setUint16(28, entry.nameBytes.length, true);
      record.setUint32(42, entry.offset, true); // the rest (extra, comment, disk, attributes) are 0
      await this.write(new Uint8Array(record.buffer));
      await this.write(entry.nameBytes);
      this.offset += 46 + entry.nameBytes.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, this.offset - start, true);
    end.setUint32(16, start, true);
    await this.write(new Uint8Array(end.buffer));
  }
}
