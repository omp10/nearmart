import { env } from '../../config/env.js';
import { AuthError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import { User } from '../users/user.model.js';
import { Staff } from '../staff/staff.model.js';
import { FULL_PERMISSIONS } from '../staff/permissions.js';
import { requestOtp, verifyOtp } from './otp.service.js';
import {
    consumeRefreshToken,
    issueRefreshToken,
    revokeAllForSubject,
    revokeRefreshToken,
    signAccessToken
} from './token.service.js';

const SUBJECT_MODELS = { user: User, staff: Staff };

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

// ─── Staff (admin / ops panel) ───

export const staffLogin = async ({ email, password }, meta = {}) => {
    const staff = await Staff.findOne({ email: String(email).toLowerCase().trim() }).select('+password');
    // Same message for unknown email and wrong password, so the form can't be used to find accounts.
    if (!staff || !(await staff.comparePassword(password))) throw new AuthError('Invalid email or password');
    if (!staff.isActive) throw new ForbiddenError('This account has been deactivated');

    staff.lastLoginAt = new Date();
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

    const role = record.kind === 'user' ? 'customer' : subject.role;
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
    return kind === 'user' ? customerProfile(doc) : staffProfile(doc);
};
