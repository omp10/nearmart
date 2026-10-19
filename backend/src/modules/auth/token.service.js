import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AuthError } from '../../lib/errors.js';
import { RefreshToken } from './refreshToken.model.js';

const ISSUER = 'nearmart';

/** HMAC rather than a bare hash: a stolen table cannot be checked against guessed tokens. */
export const hashSecret = (value) =>
    crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(String(value)).digest('hex');

/**
 * @param {{ id: string, kind: 'user'|'staff', role: string, tokenVersion: number }} subject
 */
export const signAccessToken = ({ id, kind, role, tokenVersion }) =>
    jwt.sign({ kind, role, tv: tokenVersion }, env.JWT_ACCESS_SECRET, {
        algorithm: 'HS256',
        subject: String(id),
        issuer: ISSUER,
        expiresIn: env.JWT_ACCESS_EXPIRES_SECONDS
    });

export const verifyAccessToken = (token) => {
    try {
        // Pin the algorithm: never let the token's own header choose how it is checked.
        return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, algorithms: ['HS256'] });
    } catch {
        throw new AuthError('Invalid or expired token');
    }
};

/** How long after rotation a reused token counts as a concurrent refresh rather than replay. */
const REUSE_GRACE_MS = 10_000;

const refreshTtlMs = () => env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000;

export const issueRefreshToken = async ({ id, kind, tokenVersion }, { family, userAgent, ip } = {}) => {
    const raw = crypto.randomBytes(48).toString('base64url');
    await RefreshToken.create({
        subjectId: id,
        kind,
        tokenHash: hashSecret(raw),
        family: family || crypto.randomUUID(),
        tokenVersion,
        expiresAt: new Date(Date.now() + refreshTtlMs()),
        userAgent: String(userAgent || '').slice(0, 300),
        ip: String(ip || '')
    });
    return raw;
};

/**
 * Consumes a refresh token and returns its record. The token is revoked in the
 * same atomic update that finds it, so two concurrent refreshes with the same
 * token cannot both succeed.
 */
export const consumeRefreshToken = async (raw) => {
    if (!raw) throw new AuthError('Refresh token is required');
    const tokenHash = hashSecret(raw);
    const now = new Date();

    const record = await RefreshToken.findOneAndUpdate(
        { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now } },
        { new: false }
    ).lean();

    if (record) return record;

    // Not consumable. If it exists but was already used, someone replayed it:
    // end every session from that login.
    const reused = await RefreshToken.findOne({ tokenHash }).select('family revokedAt').lean();
    if (reused?.revokedAt) {
        // Two browser tabs refreshing at once both send the same cookie. The
        // loser arrives moments after the winner rotated it; that is a race,
        // not theft, and the browser already holds the new cookie to retry with.
        if (now - reused.revokedAt < REUSE_GRACE_MS) {
            throw new AuthError('Session was just refreshed; retry', 'REFRESH_RACE');
        }
        await RefreshToken.updateMany({ family: reused.family, revokedAt: null }, { $set: { revokedAt: now } });
    }
    throw new AuthError('Session expired. Please sign in again.');
};

export const revokeRefreshToken = async (raw) => {
    if (!raw) return false;
    const res = await RefreshToken.updateOne(
        { tokenHash: hashSecret(raw), revokedAt: null },
        { $set: { revokedAt: new Date() } }
    );
    return res.modifiedCount > 0;
};

export const revokeAllForSubject = (subjectId, kind) =>
    RefreshToken.updateMany({ subjectId, kind, revokedAt: null }, { $set: { revokedAt: new Date() } });
