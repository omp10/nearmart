import { logger } from '../../lib/logger.js';
import { NotFoundError } from '../../lib/errors.js';
import { DeviceToken } from './deviceToken.model.js';
import { Notification } from './notification.model.js';
import { sendToOwner } from './push.service.js';
import { Staff } from '../staff/staff.model.js';
import { STAFF_ROLES } from '../staff/permissions.js';

/**
 * Attaches a device token to an account. A token belongs to one account at a
 * time, so re-registering it moves it. With `exclusive`, the account's other
 * tokens are dropped (customers have single-device sessions).
 */
export const registerDevice = async ({ ownerKind, ownerId, token, platform }, { exclusive = false } = {}) => {
    await DeviceToken.updateOne(
        { token },
        { $set: { ownerKind, ownerId, platform, lastSeenAt: new Date() } },
        { upsert: true }
    );
    if (exclusive) {
        await DeviceToken.deleteMany({ ownerKind, ownerId, token: { $ne: token } });
    }
};

export const unregisterDevice = ({ ownerKind, ownerId, token }) =>
    token ? DeviceToken.deleteOne({ token, ownerKind, ownerId }) : DeviceToken.deleteMany({ ownerKind, ownerId });

/**
 * Stores the notification in the inbox and pushes it. Push failures are
 * logged, never thrown: the event that triggered this has already happened.
 */
export const notify = async ({ ownerKind, ownerId }, { title, body = '', type = 'general', data, imageUrl }) => {
    const doc = await Notification.create({ ownerKind, ownerId, title, body, type, data });
    try {
        await sendToOwner(
            { ownerKind, ownerId },
            { title, body, imageUrl, data: { ...data, type, notificationId: String(doc._id) } }
        );
    } catch (err) {
        logger.warn({ err: err.message, ownerKind, ownerId: String(ownerId) }, 'Push send failed');
    }
    return doc;
};

/**
 * Alerts every active staff member who can see `section` for `module`:
 * super admins, admins holding the permission, and ops users assigned to the
 * module who hold it. Never throws; an alert failing must not fail the order.
 */
export const notifyStaff = async ({ module, section }, message) => {
    try {
        const staff = await Staff.find({
            isActive: true,
            $and: [
                { $or: [{ isSuperAdmin: true }, { [`permissions.${section}`]: 'view' }] },
                { $or: [{ role: STAFF_ROLES.ADMIN }, { modules: module }] }
            ]
        })
            .select('_id')
            .lean();
        await Promise.all(staff.map((s) => notify({ ownerKind: 'staff', ownerId: s._id }, message)));
    } catch (err) {
        logger.warn({ err: err.message, module, section }, 'Staff alert failed');
    }
};

export const listInbox =async ({ ownerKind, ownerId }, { page = 1, limit = 20 } = {}) => {
    const filter = { ownerKind, ownerId };
    const [items, total, unread] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Notification.countDocuments(filter),
        Notification.countDocuments({ ...filter, readAt: null })
    ]);
    return { items, page, limit, total, unread };
};

export const markRead = async ({ ownerKind, ownerId }, id) => {
    const res = await Notification.updateOne({ _id: id, ownerKind, ownerId }, { $set: { readAt: new Date() } });
    if (res.matchedCount === 0) throw new NotFoundError('Notification not found');
};

export const markAllRead = ({ ownerKind, ownerId }) =>
    Notification.updateMany({ ownerKind, ownerId, readAt: null }, { $set: { readAt: new Date() } });
