import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema(
    {
        label: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
        name: { type: String, trim: true, default: '' },
        phone: { type: String, trim: true, default: '' },
        line1: { type: String, required: true, trim: true },
        line2: { type: String, trim: true, default: '' },
        landmark: { type: String, trim: true, default: '' },
        city: { type: String, required: true, trim: true },
        state: { type: String, required: true, trim: true },
        pincode: { type: String, required: true, trim: true, match: /^\d{6}$/ },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            // [lng, lat]
            coordinates: {
                type: [Number],
                default: undefined,
                validate: {
                    validator: (v) =>
                        v === undefined || (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)),
                    message: 'location.coordinates must be [lng, lat]'
                }
            }
        },
        isDefault: { type: Boolean, default: false }
    },
    { _id: true, timestamps: true }
);

/** A customer of the mobile app. Staff live in their own collection. */
const userSchema = new mongoose.Schema(
    {
        phone: { type: String, required: true, unique: true, trim: true },
        name: { type: String, trim: true, default: '' },
        email: { type: String, trim: true, lowercase: true, default: '' },
        profileImage: { type: String, default: '' },
        addresses: { type: [addressSchema], default: [] },
        preferences: {
            notifications: { type: Boolean, default: true }
        },
        isActive: { type: Boolean, default: true, index: true },
        /**
         * Bumped on every login and embedded in the access token. A token whose
         * version is behind is rejected, so signing in on a new phone signs the
         * old one out (single-device sessions, as in the previous platform).
         */
        tokenVersion: { type: Number, default: 0 },
        lastLoginAt: { type: Date, default: null }
    },
    { collection: 'users', timestamps: true }
);

userSchema.index({ 'addresses.location': '2dsphere' });

userSchema.set('toJSON', {
    transform: (_doc, ret) => {
        delete ret.__v;
        return ret;
    }
});

export const User = mongoose.model('User', userSchema);
