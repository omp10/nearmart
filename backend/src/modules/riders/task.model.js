import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One trip leg for a delivery partner:
 *   order_delivery  store → customer   (order ready → dispatched → delivered)
 *   laundry_pickup  customer → laundry (booking pickup_scheduled → picked_up)
 *   laundry_return  laundry → customer (booking ready → out_for_return → completed)
 *
 *   offered → accepted → at_pickup → picked_up → at_drop → completed
 *      ├→ rejected / expired          (offer not taken; admin assigns again)
 *      └→ failed / cancelled          (from any active step)
 */
export const TASK_KINDS = Object.freeze(['order_delivery', 'laundry_pickup', 'laundry_return']);
export const TASK_STATUSES = Object.freeze(['offered', 'accepted', 'at_pickup', 'picked_up', 'at_drop', 'completed', 'failed', 'rejected', 'expired', 'cancelled']);
export const ACTIVE_TASK_STATUSES = Object.freeze(['offered', 'accepted', 'at_pickup', 'picked_up', 'at_drop']);
export const FAIL_REASONS = Object.freeze(['customer_unreachable', 'wrong_address', 'refused', 'other']);

const placeSchema = new mongoose.Schema(
    {
        name: { type: String, default: '' },
        phone: { type: String, default: '' },
        address: { type: String, default: '' },
        landmark: { type: String, default: '' },
        lat: { type: Number, default: null },
        lng: { type: Number, default: null }
    },
    { _id: false }
);

const taskSchema = new mongoose.Schema(
    {
        kind: { type: String, enum: TASK_KINDS, required: true },
        status: { type: String, enum: TASK_STATUSES, required: true, default: 'offered' },
        module: { type: String, enum: BUSINESS_MODULES, required: true },
        ref: {
            type: { type: String, enum: ['order', 'booking'], required: true },
            id: { type: ObjectId, required: true },
            number: { type: String, default: '' }
        },
        rider: { type: ObjectId, ref: 'Rider', required: true },
        pickup: { type: placeSchema, default: () => ({}) },
        drop: { type: placeSchema, default: () => ({}) },
        items: { type: [{ _id: false, name: String, variantLabel: String, qty: Number }], default: [] },
        slot: { date: String, label: String },
        notes: { type: String, default: '' },
        payment: {
            method: { type: String, enum: ['cod', 'online'], default: 'online' },
            /** Cash/UPI the partner must take at the door (0 when prepaid). */
            collectPaise: { type: Number, default: 0 }
        },
        /** 4-digit code the customer reads out at handover; null when not needed. */
        otp: { type: String, default: null, select: false },
        collected: { paise: Number, mode: { type: String, enum: ['cash', 'upi'] } },
        photos: { type: [String], default: [] },
        payoutPaise: { type: Number, default: 0 },
        offerExpiresAt: { type: Date, default: null },
        failReason: { type: String, enum: [...FAIL_REASONS, null], default: null },
        failNote: { type: String, default: '' },
        assignedBy: { type: ObjectId, ref: 'Staff', default: null },
        completedAt: { type: Date, default: null },
        timeline: {
            type: [{ _id: false, status: String, at: { type: Date, default: Date.now }, note: { type: String, default: '' } }],
            default: []
        }
    },
    { collection: 'delivery_tasks', timestamps: true }
);

taskSchema.index({ rider: 1, status: 1, createdAt: -1 });
taskSchema.index({ 'ref.id': 1, status: 1 });
taskSchema.index({ status: 1, offerExpiresAt: 1 });
taskSchema.index({ rider: 1, completedAt: -1 });

export const DeliveryTask = mongoose.model('DeliveryTask', taskSchema);

const depositSchema = new mongoose.Schema(
    {
        rider: { type: ObjectId, ref: 'Rider', required: true },
        amountPaise: { type: Number, required: true, min: 1 },
        mode: { type: String, enum: ['upi', 'store'], required: true },
        reference: { type: String, default: '', maxlength: 120 },
        status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending' },
        decidedBy: { type: ObjectId, ref: 'Staff', default: null },
        decidedAt: { type: Date, default: null }
    },
    { collection: 'rider_deposits', timestamps: true }
);

depositSchema.index({ rider: 1, createdAt: -1 });
depositSchema.index({ status: 1, createdAt: -1 });

export const CashDeposit = mongoose.model('CashDeposit', depositSchema);
