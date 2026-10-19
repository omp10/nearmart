import { NotFoundError } from '../../lib/errors.js';
import { MODULE_DEFAULTS, ModuleSetting } from './module.model.js';

/** Creates any missing module rows; never overwrites admin edits. */
const ensureModules = () =>
    ModuleSetting.bulkWrite(
        MODULE_DEFAULTS.map((m) => ({
            updateOne: { filter: { key: m.key }, update: { $setOnInsert: m }, upsert: true }
        })),
        { ordered: false }
    );

export const listModules = async ({ activeOnly = false } = {}) => {
    await ensureModules();
    return ModuleSetting.find(activeOnly ? { isActive: true } : {}).sort({ sortOrder: 1 }).lean();
};

export const updateModule = async (key, patch) => {
    await ensureModules();
    const doc = await ModuleSetting.findOneAndUpdate({ key }, { $set: patch }, { new: true, runValidators: true }).lean();
    if (!doc) throw new NotFoundError('Module not found');
    return doc;
};

/** Keys of modules customers can currently shop in. A missing row counts as active. */
export const inactiveModuleKeys = async () =>
    (await ModuleSetting.find({ isActive: false }).select('key').lean()).map((m) => m.key);
