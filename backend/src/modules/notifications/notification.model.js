import mongoose from 'mongoose';

/** The in-app notification inbox (scope §2). Push is a best-effort copy of these. */
const notificationSchema = new mongoose.Schema(
    {
        ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
        ownerKind: { type: String, enum: ['user', 'staff', 'rider'], required: true },
        title: { type: String, required: true, trim: true, maxlength: 120 },
        body: { type: String, trim: true, default: '', maxlength: 500 },
        /** Machine-readable event, e.g. `order.dispatched`, for the app to route on tap. */
        type: { type: String, trim: true, default: 'general' },
        data: { type: Map, of: String, default: undefined },
        readAt: { type: Date, default: null }
    },
    { collection: 'notifications', timestamps: true }
);

notificationSchema.index({ ownerKind: 1, ownerId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const Notification = mongoose.model('Notification', notificationSchema);
