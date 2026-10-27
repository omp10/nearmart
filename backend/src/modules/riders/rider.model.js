import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

export const VEHICLES = Object.freeze(['bike', 'scooter', 'cycle', 'car', 'walk']);

/**
 * A delivery partner. Created by an admin; signs in to the rider app with a
 * phone OTP. `modules` limits which shops' tasks they can take (empty = all).
 */
const riderSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 80 },
        phone: { type: String, required: true, unique: true, trim: true },
        vehicle: { type: String, enum: VEHICLES, default: 'bike' },
        modules: { type: [String], enum: BUSINESS_MODULES, default: [] },
        /** What the partner earns for each completed task. */
        payoutPerTaskPaise: { type: Number, min: 0, default: 3000 },
        isActive: { type: Boolean, default: true },
        isOnline: { type: Boolean, default: false },
        lastSeenAt: { type: Date, default: null },
        /** Last GPS fix from the rider app (sent every ~15 s while online). */
        lastLocation: { lat: { type: Number, default: null }, lng: { type: Number, default: null }, at: { type: Date, default: null } },
        /** Cash on delivery collected and not yet deposited with the store. */
        cashInHandPaise: { type: Number, default: 0 },
        /** Bumped on deactivation or a new sign-in, ending older sessions at once. */
        tokenVersion: { type: Number, default: 0 },
        lastLoginAt: { type: Date, default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null }
    },
    { collection: 'riders', timestamps: true }
);

riderSchema.index({ isActive: 1, isOnline: 1 });

export const Rider = mongoose.model('Rider', riderSchema);
