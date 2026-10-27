import mongoose from 'mongoose';

export const STOCK_REASONS = Object.freeze([
    'initial', // stock entered when a variant is created
    'restock', // goods received
    'adjustment', // manual correction (count, damage, expiry)
    'order', // sold (Phase 3)
    'order_cancelled' // returned to stock on cancellation (Phase 3)
]);

/** Append-only ledger of every stock change, for the inventory history view and audits. */
const stockMovementSchema = new mongoose.Schema(
    {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        variant: { type: mongoose.Schema.Types.ObjectId, required: true },
        module: { type: String, required: true },
        sku: { type: String, default: '' },
        label: { type: String, default: '' },
        delta: { type: Number, required: true },
        after: { type: Number, required: true },
        reason: { type: String, enum: STOCK_REASONS, required: true },
        note: { type: String, trim: true, default: '', maxlength: 300 },
        /** Order or booking that caused the change, when there is one. */
        refId: { type: mongoose.Schema.Types.ObjectId, default: null },
        actor: {
            kind: { type: String, enum: ['staff', 'user', 'seller', 'system'], default: 'system' },
            id: { type: mongoose.Schema.Types.ObjectId, default: null }
        }
    },
    { collection: 'stock_movements', timestamps: { createdAt: true, updatedAt: false } }
);

stockMovementSchema.index({ product: 1, variant: 1, createdAt: -1 });
stockMovementSchema.index({ module: 1, createdAt: -1 });

export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
