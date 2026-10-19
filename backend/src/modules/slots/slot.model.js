import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

export const SLOT_KINDS = Object.freeze(['delivery', 'pickup', 'return']);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A repeating weekly time window, e.g. "Mon–Sat 09:00–12:00, 40 orders".
 * Concrete slots for each date are generated from these, not stored.
 *
 * A rule with no zone applies everywhere the module is served; once a zone
 * has its own rules for a module and kind, only those apply there.
 */
const slotRuleSchema = new mongoose.Schema(
    {
        module: { type: String, enum: BUSINESS_MODULES, required: true },
        zone: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', default: null },
        /** delivery (goods), pickup and return (laundry). */
        kind: { type: String, enum: SLOT_KINDS, required: true },
        /** 0 = Sunday … 6 = Saturday. */
        daysOfWeek: {
            type: [Number],
            validate: [(v) => v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), 'Pick at least one day']
        },
        start: { type: String, required: true, match: [HHMM, 'Use HH:MM'] },
        end: { type: String, required: true, match: [HHMM, 'Use HH:MM'] },
        /** Orders/bookings accepted per slot per date. */
        capacity: { type: Number, required: true, min: 1 },
        /** Ordering closes this many minutes before the slot starts. */
        cutoffMinutes: { type: Number, min: 0, default: 60 },
        isActive: { type: Boolean, default: true }
    },
    { collection: 'slot_rules', timestamps: true }
);

slotRuleSchema.pre('validate', function checkTimes() {
    if (this.start && this.end && this.start >= this.end) this.invalidate('end', 'The slot must end after it starts');
    this.daysOfWeek = [...new Set(this.daysOfWeek)].sort();
});

slotRuleSchema.index({ module: 1, kind: 1, zone: 1, isActive: 1 });

export const SlotRule = mongoose.model('SlotRule', slotRuleSchema);

/** A date with no slots (holiday, stock-take), for one module and/or zone or everywhere. */
const blackoutSchema = new mongoose.Schema(
    {
        date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        module: { type: String, enum: BUSINESS_MODULES, default: null },
        zone: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', default: null },
        reason: { type: String, trim: true, default: '', maxlength: 120 }
    },
    { collection: 'slot_blackouts', timestamps: true }
);
blackoutSchema.index({ date: 1 });

export const SlotBlackout = mongoose.model('SlotBlackout', blackoutSchema);

/** How many orders hold each rule's slot on each date. Capacity is enforced on this counter. */
const reservationSchema = new mongoose.Schema(
    {
        rule: { type: mongoose.Schema.Types.ObjectId, required: true },
        date: { type: String, required: true },
        count: { type: Number, default: 0, min: 0 }
    },
    { collection: 'slot_reservations', timestamps: true }
);
reservationSchema.index({ rule: 1, date: 1 }, { unique: true });

export const SlotReservation = mongoose.model('SlotReservation', reservationSchema);
