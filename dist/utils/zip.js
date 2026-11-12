"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createZipBuffer = createZipBuffer;
const archiver_1 = __importDefault(require("archiver"));
const stream_1 = require("stream");
/**
 * Compresses an array of files into a zip Buffer in memory.
 */
async function createZipBuffer(files) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const output = new stream_1.Writable({
            write(chunk, encoding, callback) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                callback();
            },
        });
        const archive = (0, archiver_1.default)('zip', {
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
//# sourceMappingURL=zip.js.map