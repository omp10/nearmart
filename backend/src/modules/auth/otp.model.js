import mongoose from 'mongoose';

/** At most one live OTP per phone. The code itself is never stored, only its HMAC. */
const otpSchema = new mongoose.Schema(
    {
        phone: { type: String, required: true, unique: true },
        codeHash: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        attempts: { type: Number, default: 0 },
        requestCount: { type: Number, default: 1 },
        windowStartedAt: { type: Date, default: Date.now }
    },
    { collection: 'otps', timestamps: true }
);

// Keep the row past code expiry so the request-rate window still applies;
// drop it once the window is certainly over.
otpSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const Otp = mongoose.model('Otp', otpSchema);
