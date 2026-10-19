import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { TooManyRequestsError } from '../../lib/errors.js';
import { Otp } from './otp.model.js';
import { hashSecret } from './token.service.js';
import { sendOtpSms } from './sms.provider.js';

const hashCode = (phone, code) => hashSecret(`otp:${phone}:${code}`);

const generateCode = () => {
    if (env.USE_DEFAULT_OTP) return env.DEFAULT_OTP_CODE;
    const max = 10 ** env.OTP_LENGTH;
    return String(crypto.randomInt(0, max)).padStart(env.OTP_LENGTH, '0');
};

/**
 * Creates a fresh OTP for the phone and sends it. Limited to
 * OTP_MAX_REQUESTS_PER_WINDOW sends per OTP_REQUEST_WINDOW_SECONDS.
 *
 * @returns {Promise<string>} the code (callers decide whether it may be exposed)
 */
export const requestOtp = async (phone) => {
    const now = new Date();
    const windowMs = env.OTP_REQUEST_WINDOW_SECONDS * 1000;
    const existing = await Otp.findOne({ phone }).lean();

    const inWindow = existing && now - existing.windowStartedAt < windowMs;
    if (inWindow && existing.requestCount >= env.OTP_MAX_REQUESTS_PER_WINDOW) {
        const retryInMin = Math.ceil((windowMs - (now - existing.windowStartedAt)) / 60000);
        throw new TooManyRequestsError(`Too many OTP requests. Try again in ${retryInMin} minute(s).`);
    }

    const code = generateCode();
    await Otp.updateOne(
        { phone },
        {
            $set: {
                codeHash: hashCode(phone, code),
                expiresAt: new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000),
                attempts: 0,
                ...(inWindow ? {} : { requestCount: 1, windowStartedAt: now })
            },
            ...(inWindow ? { $inc: { requestCount: 1 } } : {})
        },
        { upsert: true }
    );

    if (!env.USE_DEFAULT_OTP) {
        try {
            await sendOtpSms(phone, code);
        } catch (err) {
            // The code is stored; the user can ask again. Don't fail the request on a vendor hiccup.
            logger.error({ err: err.message, phone }, 'OTP SMS delivery failed');
        }
    }
    return code;
};

/**
 * Checks a code. Attempts are counted atomically before comparing, and a
 * matching code is deleted in the same operation that confirms it, so each
 * code works exactly once even under concurrent requests.
 *
 * @returns {Promise<{ valid: true } | { valid: false, reason: string }>}
 */
export const verifyOtp = async (phone, code) => {
    const now = new Date();
    const record = await Otp.findOneAndUpdate(
        { phone, expiresAt: { $gt: now }, attempts: { $lt: env.OTP_MAX_ATTEMPTS } },
        { $inc: { attempts: 1 } },
        { new: true }
    ).lean();

    if (!record) {
        const stale = await Otp.findOne({ phone }).select('expiresAt attempts').lean();
        if (!stale) return { valid: false, reason: 'Request a new OTP' };
        if (stale.expiresAt <= now) return { valid: false, reason: 'OTP expired. Request a new one.' };
        return { valid: false, reason: 'Too many wrong attempts. Request a new OTP.' };
    }

    const consumed = await Otp.findOneAndDelete({ _id: record._id, codeHash: hashCode(phone, String(code)) });
    if (!consumed) return { valid: false, reason: 'Incorrect OTP' };
    return { valid: true };
};
