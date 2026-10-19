import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

/**
 * Display and on/off settings for the four fixed business modules (scope §7:
 * "activation/deactivation of modules"). The set of modules is fixed in code;
 * only these settings are editable.
 */
const moduleSchema = new mongoose.Schema(
    {
        key: { type: String, enum: BUSINESS_MODULES, required: true, unique: true },
        name: { type: String, required: true, trim: true, maxlength: 60 },
        description: { type: String, trim: true, default: '', maxlength: 300 },
        image: { type: String, default: '' },
        isActive: { type: Boolean, default: true },
        sortOrder: { type: Number, default: 0 }
    },
    { collection: 'modules', timestamps: true }
);

export const ModuleSetting = mongoose.model('ModuleSetting', moduleSchema);

export const MODULE_DEFAULTS = Object.freeze([
    { key: 'grocery', name: 'Grocery', sortOrder: 1 },
    { key: 'produce', name: 'Vegetables & Fresh Produce', sortOrder: 2 },
    { key: 'laundry', name: 'Laundry Services', sortOrder: 3 },
    { key: 'electronics', name: 'Electrical & Electronics', sortOrder: 4 }
]);

/** Modules whose catalogue is products. Laundry sells services (Phase 4). */
export const PRODUCT_MODULES = Object.freeze(['grocery', 'produce', 'electronics']);
