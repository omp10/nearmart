import mongoose from 'mongoose';
import { BUSINESS_MODULES } from '../staff/permissions.js';

const paise = { type: Number, min: 0, default: null, validate: { validator: (v) => v == null || Number.isInteger(v), message: '{PATH} must be whole paise' } };

/**
 * A service area (scope §2, §7). An address is inside a zone when its pincode
 * is listed or its map point falls within the zone's polygon; a zone can use
 * either method or both, so pincode-only service works without a map API.
 */
const zoneSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 80 },
        isActive: { type: Boolean, default: true },
        /** Modules offered in this zone (laundry pickup may cover a different area than grocery). */
        modules: { type: [String], enum: BUSINESS_MODULES, default: [] },
        pincodes: { type: [String], default: [] },
        polygon: {
            type: { type: String, enum: ['Polygon', 'MultiPolygon'] },
            // No default: an empty array would make the 2dsphere index reject the document.
            coordinates: { type: Array, default: undefined }
        },
        /** When zones overlap, the lowest number wins (its slots and fees apply). */
        priority: { type: Number, default: 0 },
        // Delivery charges applied at checkout (Phase 3).
        minOrderPaise: paise,
        deliveryFeePaise: paise,
        freeDeliveryAbovePaise: paise
    },
    { collection: 'zones', timestamps: true }
);

zoneSchema.index({ pincodes: 1, isActive: 1 });
zoneSchema.index({ polygon: '2dsphere' });

zoneSchema.pre('validate', function normalize() {
    this.pincodes = [...new Set((this.pincodes || []).map((p) => String(p).trim()).filter(Boolean))].sort();
    // A nested path always reads back as an object, so test its `type`, not the object.
    const hasPolygon = Boolean(this.polygon?.type);
    if (!hasPolygon) this.polygon = undefined;
    if (!this.pincodes.length && !hasPolygon) {
        this.invalidate('pincodes', 'Add at least one pincode or a map area');
    }
});

export const Zone = mongoose.model('Zone', zoneSchema);
