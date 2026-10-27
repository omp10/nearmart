import mongoose from 'mongoose';
import { BOOKING_STATUSES } from './booking.flow.js';

const { ObjectId } = mongoose.Schema.Types;

const slotSnapshot = { id: String, date: String, start: Date, end: Date, label: String };

/** A service on the booking, priced first on the customer's estimate, then on the weighed quantity. */
const lineSchema = new mongoose.Schema(
    {
        service: { type: ObjectId, ref: 'LaundryService', required: true },
        name: { type: String, required: true },
        pricingUnit: { type: String, enum: ['kg', 'piece'], required: true },
        ratePaise: { type: Number, required: true },
        minQty: { type: Number, default: 0 },
        gstRate: { type: Number, default: 0 },
        estimatedQty: { type: Number, required: true, min: 0 },
        estimatePaise: { type: Number, required: true },
        finalQty: { type: Number, default: null },
        finalPaise: { type: Number, default: null }
    },
    { _id: true }
);

const laundryBookingSchema = new mongoose.Schema(
    {
        bookingNumber: { type: String, required: true, unique: true },
        user: { type: ObjectId, ref: 'User', required: true },
        zone: { type: ObjectId, ref: 'Zone', required: true },
        address: {
            name: String,
            phone: String,
            line1: String,
            line2: String,
            landmark: String,
            city: String,
            state: String,
            pincode: String,
            location: { type: { type: String }, coordinates: { type: [Number], default: undefined } }
        },
        customerPhone: { type: String, required: true },
        items: { type: [lineSchema], validate: [(v) => v.length > 0, 'Choose at least one service'] },
        pickupSlot: slotSnapshot,
        returnSlot: slotSnapshot,
        instructions: { type: String, default: '', maxlength: 500 },
        pickupNotes: { type: String, default: '', maxlength: 300 },
        pricing: {
            estimatePaise: { type: Number, required: true },
            /** Pickup/return fee, fixed at booking. */
            deliveryFeePaise: { type: Number, default: 0 },
            /** Set when weighed. */
            finalPaise: { type: Number, default: null },
            /** finalPaise once weighed, otherwise the estimate; both include the fee. */
            totalPaise: { type: Number, required: true },
            taxPaise: { type: Number, default: 0 }
        },
        payment: {
            method: { type: String, enum: ['cod', 'online'], required: true },
            status: { type: String, enum: ['pending', 'paid', 'refund_pending', 'refunded', 'partially_refunded'], default: 'pending' },
            paymentId: { type: ObjectId, ref: 'Payment', default: null },
            /** Captured online so far. */
            paidPaise: { type: Number, default: 0 },
            /** Still to collect at return (cash), after weighing. */
            balanceDuePaise: { type: Number, default: 0 },
            refundPendingPaise: { type: Number, default: 0 }
        },
        status: { type: String, enum: BOOKING_STATUSES, required: true, index: true },
        statusHistory: {
            type: [
                {
                    _id: false,
                    status: String,
                    at: { type: Date, default: Date.now },
                    by: { kind: { type: String, enum: ['user', 'staff', 'rider', 'system'] }, id: ObjectId },
                    note: { type: String, default: '' }
                }
            ],
            default: []
        },
        cancelReason: { type: String, default: '' },
        paymentDueBy: { type: Date, default: null }
    },
    { collection: 'laundry_bookings', timestamps: true }
);

laundryBookingSchema.index({ user: 1, createdAt: -1 });
laundryBookingSchema.index({ status: 1, createdAt: -1 });
laundryBookingSchema.index({ 'pickupSlot.date': 1 });
laundryBookingSchema.index({ status: 1, paymentDueBy: 1 });

export const LaundryBooking = mongoose.model('LaundryBooking', laundryBookingSchema);
