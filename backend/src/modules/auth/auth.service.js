import { env } from '../../config/env.js';
import { AuthError, ForbiddenError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { User } from '../users/user.model.js';
import { Staff } from '../staff/staff.model.js';
import { Rider } from '../riders/rider.model.js';
import { FULL_PERMISSIONS } from '../staff/permissions.js';
import { requestOtp, verifyOtp } from './otp.service.js';
import {
    consumeRefreshToken,
    issueRefreshToken,
    revokeAllForSubject,
    revokeRefreshToken,
    signAccessToken
} from './token.service.js';

const SUBJECT_MODELS = { user: User, staff: Staff, rider: Rider };

const issueSession = async (subject, meta, family) => {
    const accessToken = signAccessToken(subject);
    const refreshToken = await issueRefreshToken(subject, { ...meta, family });
    return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_EXPIRES_SECONDS };
};

/** What the admin panel needs to decide which screens to show. */
export const staffProfile = (staff) => ({
    id: String(staff._id),
    name: staff.name,
    email: staff.email,
    phone: staff.phone,
    role: staff.role,
    isSuperAdmin: staff.isSuperAdmin,
    modules: staff.modules,
    permissions: staff.isSuperAdmin ? FULL_PERMISSIONS : staff.permissions || {}
});

export const customerProfile = (user) => ({
    id: String(user._id),
    phone: user.phone,
    name: user.name,
    email: user.email,
    profileImage: user.profileImage,
    addresses: user.addresses,
    preferences: user.preferences
});

// ─── Customers (mobile app) ───

/** @returns {Promise<{ devOtp?: string }>} */
export const requestCustomerOtp = async (phone) => {
    const code = await requestOtp(phone);
    // Lets the app team test without an SMS account. Never in production.
    const expose = !env.isProduction && (env.USE_DEFAULT_OTP || env.SMS_PROVIDER === 'console');
    return expose ? { devOtp: code } : {};
};

export const verifyCustomerOtp = async ({ phone, otp, name }, meta = {}) => {
    const result = await verifyOtp(phone, otp);
    if (!result.valid) throw new AuthError(result.reason);

    const trimmedName = String(name ?? '').trim();
    let user = await User.findOne({ phone });
    const isNewUser = !user;

    if (!user) {
        user = await User.create({ phone, name: trimmedName });
    } else if (trimmedName && !user.name) {
        user.name = trimmedName;
    }

    if (!user.isActive) throw new ForbiddenError('This account has been deactivated. Please contact support.');

    // Single-device sessions: the new login invalidates every earlier one.
    user.tokenVersion += 1;
    user.lastLoginAt = new Date();
    await user.save();
    await revokeAllForSubject(user._id, 'user');

    const session = await issueSession(
        { id: user._id, kind: 'user', role: 'customer', tokenVersion: user.tokenVersion },
        meta
    );
    return { ...session, isNewUser, needsName: !user.name, user: customerProfile(user) };
};

// ─── Delivery partners (rider app) ───

export const riderProfile = (rider) => ({
    id: String(rider._id),
    name: rider.name,
    phone: rider.phone,
    vehicle: rider.vehicle,
    modules: rider.modules,
    isOnline: rider.isOnline,
    payoutPerTaskPaise: rider.payoutPerTaskPaise,
    cashInHandPaise: rider.cashInHandPaise
});

const notARider = () => new ForbiddenError("This number isn't registered as a Nearmart delivery partner");

/** Only phones an admin registered as partners get a code. */
export const requestRiderOtp = async (phone) => {
    const rider = await Rider.findOne({ phone }).select('isActive').lean();
    if (!rider) throw notARider();
    if (!rider.isActive) throw new ForbiddenError('This delivery partner account is switched off. Please contact the store.');
    return requestCustomerOtp(phone);
};

export const verifyRiderOtp = async ({ phone, otp }, meta = {}) => {
    const rider = await Rider.findOne({ phone });
    if (!rider) throw notARider();
    const result = await verifyOtp(phone, otp);
    if (!result.valid) throw new AuthError(result.reason);
    if (!rider.isActive) throw new ForbiddenError('This delivery partner account is switched off. Please contact the store.');

    // One phone at a time: a new sign-in ends the previous session.
    rider.tokenVersion += 1;
    rider.lastLoginAt = new Date();
    await rider.save();
    await revokeAllForSubject(rider._id, 'rider');

    const session = await issueSession({ id: rider._id, kind: 'rider', role: 'rider', tokenVersion: rider.tokenVersion }, meta);
    return { ...session, rider: riderProfile(rider) };
};

// ─── Staff (admin / ops panel) ───

/** Wrong passwords allowed before an account locks, and for how long. */
export const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export const staffLogin = async ({ email, password }, meta = {}) => {
    const staff = await Staff.findOne({ email: String(email).toLowerCase().trim() }).select('+password');
    // Same message for unknown email and wrong password, so the form can't be used to find accounts.
    if (!staff) throw new AuthError('Invalid email or password');

    // The per-IP rate limit doesn't stop guessing spread over many IPs; this caps guesses per account.
    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
        const minutes = Math.ceil((staff.lockedUntil - Date.now()) / 60000);
        throw new TooManyRequestsError(`Too many wrong passwords. Try again in ${minutes} minute(s) or ask an admin to reset it.`);
    }
    if (!(await staff.comparePassword(password))) {
        const failed = await Staff.findOneAndUpdate({ _id: staff._id }, { $inc: { failedLogins: 1 } }, { new: true }).select('failedLogins');
        if (failed.failedLogins >= MAX_FAILED_LOGINS) {
            await Staff.updateOne({ _id: staff._id }, { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } });
        }
        throw new AuthError('Invalid email or password');
    }
    if (!staff.isActive) throw new ForbiddenError('This account has been deactivated');

    staff.lastLoginAt = new Date();
    staff.failedLogins = 0;
    staff.lockedUntil = null;
    await staff.save();

    const session = await issueSession(
        { id: staff._id, kind: 'staff', role: staff.role, tokenVersion: staff.tokenVersion },
        meta
    );
    return { ...session, user: staffProfile(staff) };
};

export const changeStaffPassword = async (staffId, { currentPassword, newPassword }) => {
    const staff = await Staff.findById(staffId).select('+password');
    if (!staff || !(await staff.comparePassword(currentPassword))) {
        throw new ValidationError('Current password is incorrect');
    }
    staff.password = newPassword;
    staff.tokenVersion += 1;
    await staff.save();
    await revokeAllForSubject(staff._id, 'staff');
};

// ─── Shared ───

export const refreshSession = async (rawToken, meta = {}) => {
    const record = await consumeRefreshToken(rawToken);
    const Model = SUBJECT_MODELS[record.kind];
    const subject = await Model.findById(record.subjectId).select('isActive tokenVersion role').lean();

    if (!subject || !subject.isActive) throw new AuthError('Account is no longer active');
    if (subject.tokenVersion !== record.tokenVersion) {
        throw new AuthError('You were signed out because this account signed in elsewhere');
    }

    const role = record.kind === 'user' ? 'customer' : record.kind === 'rider' ? 'rider' : subject.role;
    return {
        kind: record.kind,
        ...(await issueSession(
            { id: subject._id, kind: record.kind, role, tokenVersion: subject.tokenVersion },
            meta,
            record.family
        ))
    };
};

export const logout = (rawToken) => revokeRefreshToken(rawToken);

export const getMe = async ({ id, kind }) => {
    const doc = await SUBJECT_MODELS[kind].findById(id).lean();
    if (!doc) throw new AuthError('Account not found');
    if (kind === 'rider') return riderProfile(doc);
    return kind === 'user' ? customerProfile(doc) : staffProfile(doc);
};
