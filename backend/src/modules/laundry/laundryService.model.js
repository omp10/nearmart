import mongoose from 'mongoose';

/**
 * A laundry service on the price chart (scope §5): wash & fold, wash & iron,
 * dry cleaning, ironing… Baseline pricing is per kg; per-piece is supported
 * for services such as dry cleaning that are usually priced that way.
 */
const laundryServiceSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 80 },
        slug: { type: String, required: true, unique: true },
        description: { type: String, trim: true, default: '', maxlength: 500 },
        image: { type: String, default: '' },
        pricingUnit: { type: String, enum: ['kg', 'piece'], default: 'kg' },
        /** Price per kg or per piece, GST-inclusive. */
        ratePaise: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'Rate must be whole paise' } },
        /** Billed at least this many kg / pieces. */
        minQty: { type: Number, min: 0, default: 1 },
        /** Promised turnaround, shown to customers. */
        turnaroundHours: { type: Number, min: 1, default: 48 },
        gstRate: { type: Number, enum: [0, 5, 12, 18, 28], default: 18 },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true }
    },
    { collection: 'laundry_services', timestamps: true }
);

export const LaundryService = mongoose.model('LaundryService', laundryServiceSchema);

/** Amount billed for a quantity: never below the service minimum, rounded to whole paise. */
export const chargeFor = (service, qty) => Math.round(Math.max(qty, service.minQty) * service.ratePaise);
