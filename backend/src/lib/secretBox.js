import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * AES-256-GCM for secrets kept in the database (payment gateway keys), keyed
 * by SECRETS_KEY from the environment so a database dump alone can't reveal
 * them. Stored form: "v1:<iv>:<tag>:<ciphertext>", all base64.
 */

export const secretsKeyConfigured = () => Boolean(env.SECRETS_KEY);

const key = () => {
    if (!env.SECRETS_KEY) throw new Error('SECRETS_KEY is not set');
    return Buffer.from(env.SECRETS_KEY, 'hex');
};

export const encryptSecret = (plain) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
};

export const decryptSecret = (stored) => {
    const [version, iv, tag, data] = String(stored).split(':');
    if (version !== 'v1') throw new Error('Unknown secret format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
};
