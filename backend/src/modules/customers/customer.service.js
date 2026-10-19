import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { customerProfile } from '../auth/auth.service.js';
import { User } from '../users/user.model.js';
import { checkServiceability } from '../zones/zone.service.js';

export const MAX_ADDRESSES = 10;

const loadUser = async (userId) => {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError('Account not found');
    return user;
};

export const updateProfile = async (userId, patch) => {
    const user = await loadUser(userId);
    if (patch.preferences) {
        user.preferences = { ...user.preferences?.toObject?.(), ...patch.preferences };
        delete patch.preferences;
    }
    Object.assign(user, patch);
    await user.save();
    return customerProfile(user);
};

/** Each address with the modules that can deliver to it, so the app can warn before checkout. */
const withServiceability = (addresses) =>
    Promise.all(
        addresses.map(async (a) => {
            const [lng, lat] = a.location?.coordinates ?? [];
            const { modules } = await checkServiceability({ pincode: a.pincode, lat, lng });
            return { ...a, serviceableModules: modules };
        })
    );

export const listAddresses = async (userId) => {
    const user = await User.findById(userId).select('addresses').lean();
    if (!user) throw new NotFoundError('Account not found');
    return withServiceability(user.addresses);
};

/** Keeps exactly one default whenever there are addresses. */
const settleDefault = (user, preferredId) => {
    if (!user.addresses.length) return;
    const target = preferredId
        ? user.addresses.id(preferredId)
        : user.addresses.find((a) => a.isDefault) ?? user.addresses[0];
    for (const a of user.addresses) a.isDefault = String(a._id) === String(target._id);
};

const toLocation = ({ lat, lng }) =>
    lat != null && lng != null ? { type: 'Point', coordinates: [lng, lat] } : undefined;

export const addAddress = async (userId, { lat, lng, isDefault, ...fields }) => {
    const user = await loadUser(userId);
    if (user.addresses.length >= MAX_ADDRESSES) throw new ValidationError(`You can save up to ${MAX_ADDRESSES} addresses`);
    user.addresses.push({ ...fields, location: toLocation({ lat, lng }) });
    const added = user.addresses.at(-1);
    settleDefault(user, isDefault || user.addresses.length === 1 ? added._id : null);
    await user.save();
    const [result] = await withServiceability([added.toObject()]);
    return result;
};

export const updateAddress = async (userId, addressId, { lat, lng, isDefault, ...fields }) => {
    const user = await loadUser(userId);
    const address = user.addresses.id(addressId);
    if (!address) throw new NotFoundError('Address not found');
    Object.assign(address, fields);
    if (lat !== undefined || lng !== undefined) address.location = toLocation({ lat, lng });
    if (isDefault) settleDefault(user, address._id);
    await user.save();
    const [result] = await withServiceability([address.toObject()]);
    return result;
};

export const deleteAddress = async (userId, addressId) => {
    const user = await loadUser(userId);
    const address = user.addresses.id(addressId);
    if (!address) throw new NotFoundError('Address not found');
    address.deleteOne();
    settleDefault(user);
    await user.save();
};

/** A saved address of this customer, for checkout and slot lookups. */
export const getAddress = async (userId, addressId) => {
    const user = await User.findOne({ _id: userId, 'addresses._id': addressId }, { 'addresses.$': 1 }).lean();
    if (!user) throw new NotFoundError('Address not found');
    return user.addresses[0];
};
