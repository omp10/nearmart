import mongoose from 'mongoose';
import { PRODUCT_MODULES } from '../catalog/module.model.js';
import { ORDER_STATUSES } from './order.flow.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * An order line is a snapshot: name, price and tax as they were when the
 * customer paid, so later catalogue edits don't rewrite history.
 */
const lineSchema = new mongoose.Schema(
    {
        product: { type: ObjectId, ref: 'Product', required: true },
        variant: { type: ObjectId, required: true },
        name: { type: String, required: true },
        variantLabel: { type: String, default: '' },
        sku: { type: String, default: '' },
        image: { type: String, default: null },
        unit: String,
        unitQty: Number,
        mrpPaise: { type: Number, required: true },
        unitPricePaise: { type: Number, required: true },
        qty: { type: Number, required: true, min: 1 },
        lineTotalPaise: { type: Number, required: true },
        gstRate: { type: Number, default: 0 },
        taxPaise: { type: Number, default: 0 },
        /** `unavailable` when staff couldn't fulfil it (scope §3: no automatic substitution). */
        status: { type: String, enum: ['ok', 'unavailable'], default: 'ok' }
    },
    { _id: true }
);

const pricingSchema = new mongoose.Schema(
    {
        subtotalPaise: { type: Number, required: true },
        discountPaise: { type: Number, default: 0 },
        deliveryFeePaise: { type: Number, default: 0 },
        /** GST included in the item prices; informational. */
        taxPaise: { type: Number, default: 0 },
        totalPaise: { type: Number, required: true },
        /** What the customer saved against MRP. */
        savingsPaise: { type: Number, default: 0 }
    },
    { _id: false }
);

const orderSchema = new mongoose.Schema(
    {
        orderNumber: { type: String, required: true, unique: true },
        user: { type: ObjectId, ref: 'User', required: true },
        module: { type: String, enum: PRODUCT_MODULES, required: true },
        items: { type: [lineSchema], validate: [(v) => v.length > 0, 'An order needs items'] },
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
        zone: { type: ObjectId, ref: 'Zone', required: true },
        slot: {
            id: String,
            date: String,
            start: Date,
            end: Date,
            label: String
        },
        pricing: { type: pricingSchema, required: true },
        /** Pricing at checkout, before any unavailable-item adjustments. */
        originalTotalPaise: { type: Number, required: true },
        coupon: {
            code: String,
            discountPaise: Number,
            coupon: { type: ObjectId, ref: 'Coupon' }
        },
        payment: {
            method: { type: String, enum: ['cod', 'online'], required: true },
            status: {
                type: String,
                enum: ['pending', 'paid', 'failed', 'refund_pending', 'refunded', 'partially_refunded'],
                default: 'pending'
            },
            paymentId: { type: ObjectId, ref: 'Payment', default: null },
            refundPendingPaise: { type: Number, default: 0 }
        },
        status: { type: String, enum: ORDER_STATUSES, required: true, index: true },
        statusHistory: {
            type: [
                {
                    _id: false,
                    status: String,
                    at: { type: Date, default: Date.now },
                    by: { kind: { type: String, enum: ['user', 'staff', 'system'] }, id: ObjectId },
                    note: { type: String, default: '' }
                }
            ],
            default: []
        },
        notes: { type: String, default: '', maxlength: 500 },
        cancelReason: { type: String, default: '' },
        /** Unpaid online orders are cancelled after this. */
        paymentDueBy: { type: Date, default: null }
    },
    { collection: 'orders', timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ module: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, paymentDueBy: 1 });
orderSchema.index({ customerPhone: 1 });

export const Order = mongoose.model('Order', orderSchema);
