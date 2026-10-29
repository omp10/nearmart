import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { PRODUCT_MODULES } from '../catalog/module.model.js';

const BCRYPT_ROUNDS = 12;
const { ObjectId } = mongoose.Schema.Types;
const text = (max) => ({ type: String, trim: true, default: '', maxlength: max });

/**
 * draft → submitted → approved | rejected; approved ⇄ suspended.
 * A rejected application can be edited and submitted again.
 */
export const SELLER_STATUSES = Object.freeze(['draft', 'submitted', 'approved', 'rejected', 'suspended']);
export const MODULE_REQUEST_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
export const DOCUMENT_TYPES = Object.freeze(['gst', 'pan', 'fssai', 'shop_license', 'cancelled_cheque', 'id_proof', 'other']);

/** Which shops a seller sells in, each approved separately by the admin. */
const moduleRequestSchema = new mongoose.Schema(
    {
        key: { type: String, enum: PRODUCT_MODULES, required: true },
        /** Top-level categories the seller wants to list in (empty = any in the module). */
        categories: { type: [{ type: ObjectId, ref: 'Category' }], default: [] },
        status: { type: String, enum: MODULE_REQUEST_STATUSES, default: 'pending' },
        note: text(300),
        requestedAt: { type: Date, default: Date.now },
        decidedAt: { type: Date, default: null }
    },
    { _id: false }
);

/** KYC files live outside the public uploads folder; `file` is a private storage path. */
const documentSchema = new mongoose.Schema(
    {
        type: { type: String, enum: DOCUMENT_TYPES, required: true },
        file: { type: String, required: true },
        name: text(120),
        mimeType: text(60),
        uploadedAt: { type: Date, default: Date.now }
    },
    { _id: true }
);

const sellerSchema = new mongoose.Schema(
    {
        businessName: { type: String, required: true, trim: true, maxlength: 120 },
        ownerName: { type: String, required: true, trim: true, maxlength: 80 },
        phone: { type: String, required: true, unique: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true, select: false },

        status: { type: String, enum: SELLER_STATUSES, default: 'draft', index: true },
        rejectionReason: text(500),
        statusHistory: {
            type: [{ _id: false, status: String, note: String, by: { kind: String, id: ObjectId }, at: { type: Date, default: Date.now } }],
            default: []
        },
        submittedAt: { type: Date, default: null },
        reviewedAt: { type: Date, default: null },

        store: {
            description: text(1000),
            logo: text(500),
            cover: text(500),
            /** Shown to customers, e.g. "8 AM – 10 PM, closed Sunday". */
            timings: text(200),
            supportPhone: text(20)
        },
        address: {
            line1: text(200),
            line2: text(200),
            landmark: text(120),
            city: text(80),
            state: text(80),
            pincode: text(10),
            lat: { type: Number, default: null },
            lng: { type: Number, default: null }
        },
        legal: {
            gstin: text(20),
            pan: text(12),
            fssai: text(20)
        },
        bank: {
            accountName: text(120),
            accountNumber: text(30),
            ifsc: text(15),
            upiId: text(60)
        },
        documents: { type: [documentSchema], default: [] },
        modules: { type: [moduleRequestSchema], default: [] },

        /**
         * Overrides of the default commission for this seller (null = the shop's
         * default). `byModule` overrides per shop and wins over the seller-wide value.
         */
        commission: {
            percent: { type: Number, min: 0, max: 100, default: null },
            fixedFeePaise: { type: Number, min: 0, default: null },
            byModule: {
                type: Map,
                of: new mongoose.Schema(
                    { percent: { type: Number, min: 0, max: 100, default: null }, fixedFeePaise: { type: Number, min: 0, default: null } },
                    { _id: false }
                ),
                default: () => ({})
            }
        },
        /**
         * Weekly opening hours in India time (day 0 = Sunday). Empty = always open
         * (the manual switch still applies). A day with no entry is closed.
         */
        hours: {
            type: [{ _id: false, day: { type: Number, min: 0, max: 6, required: true }, open: { type: String, match: /^\d{2}:\d{2}$/, required: true }, close: { type: String, match: /^\d{2}:\d{2}$/, required: true } }],
            default: []
        },
        /** Closed all day on these dates (YYYY-MM-DD, India time). */
        holidays: { type: [{ type: String, match: /^\d{4}-\d{2}-\d{2}$/ }], default: [] },
        /** Whether the hours above had the store open at the last check (kept by a background job). */
        scheduleOpen: { type: Boolean, default: true },
        /** Service areas the seller delivers to; empty = everywhere Nearmart delivers. */
        zones: { type: [{ type: ObjectId, ref: 'Zone' }], default: [] },
        /** The seller's own open/closed switch. Closed hides their products. */
        isOpen: { type: Boolean, default: true },
        /** Login switch, separate from the application status. */
        isActive: { type: Boolean, default: true },

        tokenVersion: { type: Number, default: 0 },
        lastLoginAt: { type: Date, default: null },
        failedLogins: { type: Number, default: 0 },
        lockedUntil: { type: Date, default: null }
    },
    { collection: 'sellers', timestamps: true }
);

sellerSchema.index({ businessName: 1 });

sellerSchema.pre('save', async function hashPassword() {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
});

sellerSchema.methods.comparePassword = function comparePassword(candidate) {
    return bcrypt.compare(String(candidate ?? ''), this.password);
};

/** Modules the admin has approved for this seller. */
sellerSchema.methods.approvedModules = function approvedModules() {
    return this.modules.filter((m) => m.status === 'approved').map((m) => m.key);
};

sellerSchema.set('toJSON', {
    transform: (_doc, ret) => {
        delete ret.password;
        delete ret.__v;
        return ret;
    }
});

export const Seller = mongoose.model('Seller', sellerSchema);

/**
 * Marketplace settings: default commission per module and how long after
 * delivery an order becomes payable to its seller. One document.
 */
const marketplaceSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'marketplace', unique: true },
        commission: {
            type: Map,
            of: new mongoose.Schema({ percent: { type: Number, min: 0, max: 100, default: 10 }, fixedFeePaise: { type: Number, min: 0, default: 0 } }, { _id: false }),
            default: () => ({})
        },
        payoutHoldDays: { type: Number, min: 0, max: 60, default: 3 },
        /** Staff are alerted when a seller hasn't accepted an order this many minutes after it was placed. */
        acceptAlertMinutes: { type: Number, min: 1, max: 240, default: 10 },
        /** New seller products wait for an admin's review before customers see them. */
        reviewNewProducts: { type: Boolean, default: false }
    },
    { collection: 'marketplace_config', timestamps: true }
);

export const MarketplaceConfig = mongoose.model('MarketplaceConfig', marketplaceSchema);

/**
 * A settlement to one seller covering a set of delivered orders. Creating it
 * stamps those orders with its id so no order is ever paid twice.
 */
const payoutSchema = new mongoose.Schema(
    {
        seller: { type: ObjectId, ref: 'Seller', required: true, index: true },
        number: { type: String, required: true, unique: true },
        orders: { type: [{ type: ObjectId, ref: 'Order' }], default: [] },
        orderCount: { type: Number, default: 0 },
        adjustments: { type: [{ type: ObjectId, ref: 'SellerAdjustment' }], default: [] },
        /** Sum of the adjustments included (credits positive, debits negative). */
        adjustmentsPaise: { type: Number, default: 0 },
        /** Seller-funded coupon discounts taken out of this payout. */
        sellerDiscountPaise: { type: Number, default: 0 },
        /** Where to send the money, copied when the payout is made so a later bank change can't redirect it. */
        bank: {
            accountName: { type: String, default: '' },
            accountNumber: { type: String, default: '' },
            ifsc: { type: String, default: '' },
            upiId: { type: String, default: '' }
        },
        grossPaise: { type: Number, default: 0 },
        commissionPaise: { type: Number, default: 0 },
        feePaise: { type: Number, default: 0 },
        netPaise: { type: Number, default: 0 },
        periodTo: { type: Date, required: true },
        status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending', index: true },
        mode: { type: String, enum: ['bank', 'upi', 'cash', 'other', ''], default: '' },
        reference: text(120),
        note: text(300),
        paidAt: { type: Date, default: null },
        createdBy: { type: ObjectId, ref: 'Staff', default: null }
    },
    { collection: 'seller_payouts', timestamps: true }
);

export const Payout = mongoose.model('Payout', payoutSchema);

/**
 * A manual credit or debit to a seller's balance: a refund after delivery, a
 * damaged-goods charge, a goodwill credit. Settled by the next payout.
 */
const adjustmentSchema = new mongoose.Schema(
    {
        seller: { type: ObjectId, ref: 'Seller', required: true, index: true },
        /** Positive pays the seller more; negative takes money back. */
        amountPaise: { type: Number, required: true, validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'Enter an amount other than 0' } },
        reason: { type: String, required: true, trim: true, maxlength: 300 },
        order: { type: ObjectId, ref: 'Order', default: null },
        payout: { type: ObjectId, ref: 'Payout', default: null, index: true },
        createdBy: { type: ObjectId, ref: 'Staff', default: null }
    },
    { collection: 'seller_adjustments', timestamps: true }
);

export const SellerAdjustment = mongoose.model('SellerAdjustment', adjustmentSchema);
