import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../../config/env.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';

/**
 * Seller KYC documents (GST, PAN, licences, cheques). They sit beside the
 * public uploads folder, not inside it, so nginx never serves them; only the
 * seller who uploaded them and admins read them, through the API.
 */
const privateRoot = () => path.resolve(env.UPLOAD_STORAGE_ROOT, '..', 'private-uploads', 'kyc');

export const DOCUMENT_MIME_TYPES = Object.freeze({ 'application/pdf': '.pdf', 'image/jpeg': '.webp', 'image/png': '.webp', 'image/webp': '.webp' });
export const MAX_DOCUMENT_MB = 5;

const SAFE_NAME = /^[a-f0-9]{24}\/[0-9]+-[a-f0-9]{16}\.(pdf|webp)$/;

const resolve = (file) => {
    if (!SAFE_NAME.test(file)) throw new NotFoundError('Document not found');
    return path.join(privateRoot(), file);
};

/** Images are re-encoded (dropping anything hidden in them); PDFs must start with the PDF header. */
const prepare = async (buffer, mimeType) => {
    if (mimeType === 'application/pdf') {
        if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ValidationError('File contents do not match its type');
        return buffer;
    }
    try {
        return await sharp(buffer, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate().resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    } catch {
        throw new ValidationError('File is not a valid image');
    }
};

/** Saves one document for a seller and returns its private path. */
export const saveDocument = async (sellerId, file) => {
    if (!file?.buffer?.length) throw new ValidationError('File is required');
    const ext = DOCUMENT_MIME_TYPES[file.mimetype];
    if (!ext) throw new ValidationError('Upload a PDF, JPEG, PNG or WebP file');
    const buffer = await prepare(file.buffer, file.mimetype);
    const name = `${String(sellerId)}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const absolute = resolve(name);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);
    return { file: name, mimeType: ext === '.pdf' ? 'application/pdf' : 'image/webp' };
};

/** Streams a stored document; `file` must belong to the seller it is read for. */
export const readDocument = async (sellerId, file) => {
    if (!String(file).startsWith(`${String(sellerId)}/`)) throw new NotFoundError('Document not found');
    try {
        const buffer = await fs.readFile(resolve(file));
        return { buffer, mimeType: file.endsWith('.pdf') ? 'application/pdf' : 'image/webp' };
    } catch {
        throw new NotFoundError('Document not found');
    }
};

export const deleteDocument = (file) => fs.rm(resolve(file), { force: true }).catch(() => {});
