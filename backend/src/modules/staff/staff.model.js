import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { BUSINESS_MODULES, PERMISSION_ACTIONS, PERMISSION_SECTIONS, STAFF_ROLES } from './permissions.js';

const BCRYPT_ROUNDS = 12;

const permissionsSchema = new mongoose.Schema(
    Object.fromEntries(
        PERMISSION_SECTIONS.map((section) => [section, { type: [String], enum: PERMISSION_ACTIONS, default: undefined }])
    ),
    { _id: false, strict: true }
);

/**
 * Everyone who signs in to the web panel: admins (super or sub) and the
 * operations/vendor users of scope §8. One collection so login, sessions and
 * permission checks have a single code path.
 */
const staffSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true, select: false },
        name: { type: String, trim: true, required: true },
        phone: { type: String, trim: true, default: '' },
        role: { type: String, enum: Object.values(STAFF_ROLES), required: true },
        isSuperAdmin: { type: Boolean, default: false },
        permissions: { type: permissionsSchema, default: () => ({}) },
        /** Ops users only: which business modules they may work on. */
        modules: { type: [String], enum: BUSINESS_MODULES, default: [] },
        isActive: { type: Boolean, default: true },
        /**
         * Bumped on password change or deactivation. Access tokens carry it, so
         * existing sessions stop working at once instead of at token expiry.
         */
        tokenVersion: { type: Number, default: 0 },
        lastLoginAt: { type: Date, default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null }
    },
    { collection: 'staff', timestamps: true }
);

staffSchema.pre('save', async function hashPassword() {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
});

staffSchema.methods.comparePassword = function comparePassword(candidate) {
    return bcrypt.compare(String(candidate ?? ''), this.password);
};

staffSchema.set('toJSON', {
    transform: (_doc, ret) => {
        delete ret.password;
        delete ret.__v;
        return ret;
    }
});

export const Staff = mongoose.model('Staff', staffSchema);
