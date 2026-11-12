import archiver from 'archiver';
import { Writable } from 'stream';

export interface ZipFileInput {
  filename: string;
  buffer: Buffer;
}

/**
 * Compresses an array of files into a zip Buffer in memory.
 */
export async function createZipBuffer(files: ZipFileInput[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });

    const archive = archiver('zip', {
      zlib: { level: 9 }, // maximum compression
    });

    output.on('finish', () => {
      resolve(Buffer.concat(chunks));
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    for (const file of files) {
      archive.append(file.buffer, { name: file.filename });
    }

    archive.finalize();
  });
}

