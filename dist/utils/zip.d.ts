export interface ZipFileInput {
    filename: string;
    buffer: Buffer;
}
/**
 * Compresses an array of files into a zip Buffer in memory.
 */
export declare function createZipBuffer(files: ZipFileInput[]): Promise<Buffer>;
