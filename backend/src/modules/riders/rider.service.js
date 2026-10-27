import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { escapeRegex, paginate } from '../../lib/pagination.js';
import { revokeAllForSubject } from '../auth/token.service.js';
import { riderProfile } from '../auth/auth.service.js';
import { Rider } from './rider.model.js';
import { ACTIVE_TASK_STATUSES, DeliveryTask } from './task.model.js';
import { listTasks } from './task.service.js';

/** A rider counts as online only while their app keeps checking in. */
export const ONLINE_STALE_MINUTES = 10;

const istDayStart = (now = new Date()) => {
    const ist = new Date(now.getTime() + 5.5 * 3600_000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600_000);
};

const todayStats = async (riderId) => {
    const [row] = await DeliveryTask.aggregate([
        { $match: { rider: riderId, status: 'completed', completedAt: { $gte: istDayStart() } } },
        { $group: { _id: null, completed: { $sum: 1 }, earningsPaise: { $sum: '$payoutPaise' } } }
    ]);
    return { completed: row?.completed ?? 0, earningsPaise: row?.earningsPaise ?? 0 };
};

/** Online flag as the admin should see it: switched on and heard from recently. */
const liveOnline = (r) => Boolean(r.isOnline && r.lastSeenAt && Date.now() - new Date(r.lastSeenAt).getTime() < ONLINE_STALE_MINUTES * 60_000);

// ─── Rider app ───

export const getRiderMe = async (riderId) => {
    const rider = await Rider.findById(riderId).lean();
    if (!rider) throw new NotFoundError('Account not found');
    const today = await todayStats(rider._id);
    return { ...riderProfile(rider), today: { deliveries: today.completed, earningsPaise: today.earningsPaise, cashInHandPaise: rider.cashInHandPaise } };
};

export const setShift = async (riderId, online) => {
    if (!online && (await DeliveryTask.exists({ rider: riderId, status: { $in: ACTIVE_TASK_STATUSES.filter((s) => s !== 'offered') } }))) {
        throw new ConflictError('Finish your active task before going offline');
    }
    const rider = await Rider.findByIdAndUpdate(riderId, { $set: { isOnline: online, lastSeenAt: new Date() } }, { new: true }).lean();
    return riderProfile(rider);
};

export const recordLocation = async (riderId, { lat, lng }) => {
    const at = new Date();
    await Rider.updateOne({ _id: riderId }, { $set: { lastLocation: { lat, lng, at }, lastSeenAt: at } });
};

// ─── Admin ───

const withStats = async (riders) => {
    const counts = await DeliveryTask.aggregate([
        { $match: { rider: { $in: riders.map((r) => r._id) }, status: { $in: ACTIVE_TASK_STATUSES } } },
        { $group: { _id: '$rider', n: { $sum: 1 } } }
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    return riders.map((r) => ({ ...r, isOnline: liveOnline(r), activeTasks: byId.get(String(r._id)) ?? 0, lastLocation: r.lastLocation?.lat != null ? r.lastLocation : null }));
};

export const listRiders = async ({ q, status, page, limit }) => {
    const filter = {};
    if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { phone: new RegExp(escapeRegex(q)) }];
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    if (status === 'online') Object.assign(filter, { isActive: true, isOnline: true, lastSeenAt: { $gte: new Date(Date.now() - ONLINE_STALE_MINUTES * 60_000) } });
    const result = await paginate(Rider, filter, { page, limit, sort: { isOnline: -1, name: 1 } });
    return { ...result, items: await withStats(result.items) };
};

export const getRider = async (id) => {
    const rider = await Rider.findById(id).lean();
    if (!rider) throw new NotFoundError('Delivery partner not found');
    const [[withCounts], today, recent] = await Promise.all([withStats([rider]), todayStats(rider._id), listTasks({ status: 'all', riderId: rider._id, page: 1, limit: 15 })]);
    return { ...withCounts, today, recentTasks: recent.items };
};

export const createRider = async (input, { by }) => {
    if (await Rider.exists({ phone: input.phone })) throw new ConflictError('A delivery partner with this phone already exists');
    const rider = await Rider.create({ ...input, createdBy: by });
    return (await withStats([rider.toObject()]))[0];
};

export const updateRider = async (id, input) => {
    if (input.phone && (await Rider.exists({ phone: input.phone, _id: { $ne: id } }))) throw new ConflictError('A delivery partner with this phone already exists');
    const rider = await Rider.findById(id);
    if (!rider) throw new NotFoundError('Delivery partner not found');
    const switchingOff = input.isActive === false && rider.isActive;
    Object.assign(rider, input);
    if (switchingOff) {
        // Ends their sessions at once and takes them off shift.
        rider.tokenVersion += 1;
        rider.isOnline = false;
    }
    await rider.save();
    if (switchingOff) await revokeAllForSubject(rider._id, 'rider');
    return (await withStats([rider.toObject()]))[0];
};
