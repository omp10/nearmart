import mongoose from 'mongoose';

/**
 * One row per issued refresh token. Only an HMAC of the token is stored, so a
 * database leak does not hand out working sessions.
 *
 * Tokens rotate on every refresh. All tokens descending from one login share
 * a `family`; presenting a token that was already rotated means it was copied,
 * and the whole family is revoked.
 */
const refreshTokenSchema = new mongoose.Schema(
    {
        subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        kind: { type: String, enum: ['user', 'staff', 'rider'], required: true },
        tokenHash: { type: String, required: true, unique: true },
        family: { type: String, required: true, index: true },
        tokenVersion: { type: Number, required: true },
        expiresAt: { type: Date, required: true },
        revokedAt: { type: Date, default: null },
        userAgent: { type: String, default: '' },
        ip: { type: String, default: '' }
    },
    { collection: 'refresh_tokens', timestamps: true }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
