import mongoose from 'mongoose';

/**
 * An FCM registration token and who it belongs to. Kept in its own collection
 * (the old platform stored arrays on each profile model) so one token can only
 * ever point at one account, and pruning a dead token is a single delete.
 */
const deviceTokenSchema = new mongoose.Schema(
    {
        token: { type: String, required: true, unique: true },
        ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
        ownerKind: { type: String, enum: ['user', 'staff', 'rider', 'seller'], required: true },
        platform: { type: String, enum: ['android', 'ios', 'web'], required: true },
        lastSeenAt: { type: Date, default: Date.now }
    },
    { collection: 'device_tokens', timestamps: true }
);

deviceTokenSchema.index({ ownerKind: 1, ownerId: 1 });
// A token unseen for 60 days is almost certainly dead.
deviceTokenSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);
