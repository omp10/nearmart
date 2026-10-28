import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../../config/env.js';
import { ValidationError } from '../../lib/errors.js';

/**
 * Local-disk media storage, served by nginx under UPLOAD_BASE_URL in
 * production. Every image is re-encoded to WebP (see encode), which also
 * strips anything that isn't really an image.
 */

export const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Folders callers may write to; keeps arbitrary client strings off the disk layout. */
export const UPLOAD_FOLDERS = Object.freeze(['catalog', 'categories', 'banners', 'offers', 'services', 'profiles', 'deliveries', 'misc']);

/** Short looping clips (banners). Stored as received, so the container is checked from its magic bytes. */
export const VIDEO_MIME_TYPES = Object.freeze({ 'video/mp4': '.mp4', 'video/webm': '.webm' });
export const VIDEO_FOLDERS = Object.freeze(['banners']);

export const assertFolder = (folder) => {
    if (!UPLOAD_FOLDERS.includes(folder)) {
        throw new ValidationError(`folder must be one of: ${UPLOAD_FOLDERS.join(', ')}`);
    }
    return folder;
};

const resolveInsideRoot = (relativePath) => {
    const root = path.resolve(env.UPLOAD_STORAGE_ROOT);
    const absolute = path.resolve(root, relativePath);
    if (!absolute.startsWith(root + path.sep)) throw new ValidationError('Invalid file path');
    return absolute;
};

/**
 * The local path uploads are served under. UPLOAD_BASE_URL may be absolute
 * (https://host/uploads, so mobile apps get full URLs); Express mounts only
 * its path.
 */
export const uploadMountPath = (baseUrl) => new URL(baseUrl, 'http://localhost').pathname.replace(/\/+$/, '') || '/';

export const publicUrl = (relativePath) => `${env.UPLOAD_BASE_URL.replace(/\/+$/, '')}/${relativePath}`;

/**
 * Refuse images that decode to more than this many pixels (all frames
 * together). A few-KB file can claim enormous dimensions; decoding it would
 * exhaust memory (a "decompression bomb").
 */
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Everything, GIFs included, is decoded and re-encoded rather than stored as
 * received. Only real image data reaches the disk: bytes appended to a valid
 * image, or a script with an image extension, do not survive. Animated GIFs
 * become animated WebP.
 */
const FORMAT_FOR_MIME = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const encode = async (buffer, mimeType) => {
    const animated = mimeType === 'image/gif';
    try {
        const image = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, animated });
        const meta = await image.metadata();
        if (meta.format !== FORMAT_FOR_MIME[mimeType]) throw new ValidationError('File contents do not match its type');
        // Checked from the header before decoding anything.
        const frameW = meta.width ?? 0;
        const frameH = meta.pageHeight ?? meta.height ?? 0;
        if (frameW * frameH * (meta.pages ?? 1) > MAX_INPUT_PIXELS) {
            // Every frame of a GIF is decoded, so big GIFs hit this long before their file size would.
            throw new ValidationError(
                animated
                    ? `This GIF is too big to process (${frameW} × ${frameH}, ${meta.pages} frames). Make it 800 × 400 or shorter, or upload it as an MP4 video instead.`
                    : 'Image dimensions are too large'
            );
        }

        const pipeline = (animated ? image : image.rotate()).resize({ width: env.UPLOAD_WEBP_MAX_WIDTH, withoutEnlargement: true });
        const out = await pipeline
            .webp(meta.hasAlpha && !animated ? { lossless: true, effort: 4 } : { quality: env.UPLOAD_WEBP_QUALITY, effort: 4 })
            .toBuffer();
        return { buffer: out, ext: '.webp', mimeType: 'image/webp' };
    } catch (err) {
        if (err instanceof ValidationError) throw err;
        // Anything sharp rejects (corrupt data, pixel limit hit while decoding) is a bad upload, not a server error.
        if (/pixel limit/i.test(err?.message ?? '')) throw new ValidationError('Image dimensions are too large');
        throw new ValidationError('File is not a valid image');
    }
};

const writeUpload = async (buffer, folder, ext, mimeType) => {
    const month = new Date().toISOString().slice(0, 7);
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const relativePath = path.posix.join(assertFolder(folder), month, filename);
    const absolute = resolveInsideRoot(relativePath);

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);

    return { url: publicUrl(relativePath), path: relativePath, mimeType, size: buffer.length };
};

/** @param {{ buffer: Buffer, mimetype: string }} file a multer memory-storage file */
export const saveImage = async (file, folder) => {
    if (!file?.buffer?.length) throw new ValidationError('File is required');
    if (!IMAGE_MIME_TYPES.has(file.mimetype)) throw new ValidationError('Only JPEG, PNG, WebP and GIF images are allowed');

    const { buffer, ext, mimeType } = await encode(file.buffer, file.mimetype);
    return writeUpload(buffer, folder, ext, mimeType);
};

/** MP4 has an `ftyp` box at byte 4; WebM starts with the EBML header 1A 45 DF A3. */
const looksLike = (buffer, mimeType) =>
    mimeType === 'video/mp4'
        ? buffer.length > 12 && buffer.toString('latin1', 4, 8) === 'ftyp'
        : buffer.length > 4 && buffer.readUInt32BE(0) === 0x1a45dfa3;

/**
 * Videos can't be re-encoded here, so they're kept as received, but only when
 * the bytes really are an MP4 / WebM container, and only under a fixed
 * extension that nginx serves with a video type.
 */
export const saveVideo = async (file, folder) => {
    if (!file?.buffer?.length) throw new ValidationError('File is required');
    const ext = VIDEO_MIME_TYPES[file.mimetype];
    if (!ext) throw new ValidationError('Only MP4 and WebM videos are allowed');
    if (!VIDEO_FOLDERS.includes(folder)) throw new ValidationError(`Videos can only go in: ${VIDEO_FOLDERS.join(', ')}`);
    if (!looksLike(file.buffer, file.mimetype)) throw new ValidationError('File contents do not match its type');
    return writeUpload(file.buffer, folder, ext, file.mimetype);
};
