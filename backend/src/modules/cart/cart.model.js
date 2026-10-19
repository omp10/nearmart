import mongoose from 'mongoose';

/**
 * One cart per customer, across modules. It stores only what was picked and
 * how many; prices and availability are always read fresh from the catalogue.
 */
const cartSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
        items: {
            type: [
                {
                    _id: false,
                    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
                    variant: { type: mongoose.Schema.Types.ObjectId, required: true },
                    qty: { type: Number, required: true, min: 1, max: 99 },
                    addedAt: { type: Date, default: Date.now }
                }
            ],
            default: []
        }
    },
    { collection: 'carts', timestamps: true }
);

export const Cart = mongoose.model('Cart', cartSchema);
