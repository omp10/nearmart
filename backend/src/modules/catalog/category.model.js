import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

/** Category → subcategory → sub-subcategory. Depth is 0-based. */
export const MAX_CATEGORY_DEPTH = 2;

/**
 * Categories form a tree per module. `ancestors` holds every parent from the
 * root down, so "everything under X" is one indexed query and products can be
 * filtered by any level of their category.
 */
const categorySchema = new mongoose.Schema(
    {
        module: { type: String, enum: BUSINESS_MODULES, required: true },
        name: { type: String, required: true, trim: true, maxlength: 80 },
        slug: { type: String, required: true },
        description: { type: String, trim: true, default: '', maxlength: 500 },
        image: { type: String, default: '' },
        parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
        ancestors: { type: [mongoose.Schema.Types.ObjectId], default: [] },
        depth: { type: Number, min: 0, max: MAX_CATEGORY_DEPTH, default: 0 },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true }
    },
    { collection: 'categories', timestamps: true }
);

categorySchema.index({ module: 1, slug: 1 }, { unique: true });
categorySchema.index({ module: 1, parent: 1, sortOrder: 1 });
categorySchema.index({ ancestors: 1 });

export const Category = mongoose.model('Category', categorySchema);
