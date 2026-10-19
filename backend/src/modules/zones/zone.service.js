import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { inactiveModuleKeys } from '../catalog/module.service.js';
import { Zone } from './zone.model.js';

/**
 * Mongo rejects malformed or self-intersecting polygons when indexing them
 * (error 16755). Surfaced as a 400 with a message an admin can act on.
 */
const saveZone = async (zone) => {
    try {
        return await zone.save();
    } catch (err) {
        if (err?.code === 16755 || /geo|Loop|edges/i.test(err?.message || '')) {
            throw new ValidationError('The map area is not a valid polygon (check that its edges do not cross and the ring is closed)');
        }
        throw err;
    }
};

export const listZones = () => Zone.find().sort({ priority: 1, name: 1 }).lean();

export const getZone = async (id) => {
    const zone = await Zone.findById(id);
    if (!zone) throw new NotFoundError('Service area not found');
    return zone;
};

export const createZone = (input) => saveZone(new Zone(input));

export const updateZone = async (id, input) => {
    const zone = await getZone(id);
    Object.assign(zone, input);
    if (input.polygon === null) zone.polygon = undefined;
    return saveZone(zone);
};

export const deleteZone = async (id) => {
    const zone = await getZone(id);
    // Phase 3: refuse while open orders reference the zone.
    await zone.deleteOne();
};

/**
 * Active zones covering a location, best (lowest priority) first.
 *
 * @param {{ pincode?: string, lat?: number, lng?: number, module?: string }} where
 */
export const findZones = async ({ pincode, lat, lng, module }) => {
    const clauses = [];
    if (pincode) clauses.push({ pincodes: String(pincode).trim() });
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
        clauses.push({ polygon: { $geoIntersects: { $geometry: { type: 'Point', coordinates: [lng, lat] } } } });
    }
    if (!clauses.length) throw new ValidationError('Provide a pincode or a location');

    return Zone.find({ isActive: true, ...(module ? { modules: module } : {}), $or: clauses })
        .sort({ priority: 1, createdAt: 1 })
        .lean();
};

/**
 * Which modules a location can order from, and the zone that serves each.
 * Modules switched off in the catalogue are never offered.
 *
 * @returns {Promise<{ serviceable: boolean, modules: string[], zoneByModule: Record<string, object> }>}
 */
export const checkServiceability = async (where) => {
    const [zones, inactive] = await Promise.all([findZones({ ...where, module: undefined }), inactiveModuleKeys()]);
    const zoneByModule = {};
    for (const zone of zones) {
        for (const module of zone.modules) {
            if (!inactive.includes(module) && !zoneByModule[module]) zoneByModule[module] = zone;
        }
    }
    const modules = Object.keys(zoneByModule).sort();
    return { serviceable: modules.length > 0, modules, zoneByModule };
};

/** The zone serving `module` at an address, or null. */
export const zoneForAddress = async (address, module) => {
    const [lng, lat] = address?.location?.coordinates ?? [];
    const { zoneByModule } = await checkServiceability({ pincode: address?.pincode, lat, lng });
    return zoneByModule[module] ?? null;
};
