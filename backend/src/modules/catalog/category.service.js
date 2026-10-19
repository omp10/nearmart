import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { uniqueSlug } from '../../lib/slug.js';
import { Category, MAX_CATEGORY_DEPTH } from './category.model.js';
import { Product } from './product.model.js';

/** Builds a nested tree from a flat, sorted list. */
const toTree = (rows) => {
    const byId = new Map(rows.map((r) => [String(r._id), { ...r, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
        const parent = node.parent ? byId.get(String(node.parent)) : null;
        (parent ? parent.children : roots).push(node);
    }
    return roots;
};

const SORT = { depth: 1, sortOrder: 1, name: 1 };

export const getTree = async (module, { activeOnly = false } = {}) => {
    const rows = await Category.find({ module }).sort(SORT).lean();
    if (!activeOnly) return toTree(rows);
    // A category is visible only if it and every ancestor are active.
    const inactive = new Set(rows.filter((r) => !r.isActive).map((r) => String(r._id)));
    return toTree(rows.filter((r) => !inactive.has(String(r._id)) && !r.ancestors.some((a) => inactive.has(String(a)))));
};

export const getCategory = async (id) => {
    const doc = await Category.findById(id);
    if (!doc) throw new NotFoundError('Category not found');
    return doc;
};

const loadParent = async (parentId, module) => {
    if (!parentId) return null;
    const parent = await Category.findById(parentId).lean();
    if (!parent) throw new ValidationError('Parent category not found');
    if (parent.module !== module) throw new ValidationError('Parent category belongs to another module');
    return parent;
};

export const createCategory = async ({ module, parent: parentId, ...fields }) => {
    const parent = await loadParent(parentId, module);
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > MAX_CATEGORY_DEPTH) {
        throw new ValidationError(`Categories can be nested at most ${MAX_CATEGORY_DEPTH + 1} levels deep`);
    }
    return Category.create({
        ...fields,
        module,
        parent: parent?._id ?? null,
        ancestors: parent ? [...parent.ancestors, parent._id] : [],
        depth,
        slug: await uniqueSlug(Category, fields.name, { module })
    });
};

/** Rewrites ancestors/depth of a moved category's subtree and the paths of products in it. */
const reparentSubtree = async (category, oldAncestorCount) => {
    const descendants = await Category.find({ ancestors: category._id }).lean();
    const prefix = [...category.ancestors, category._id];
    const ops = descendants.map((d) => {
        // Everything below the moved node keeps its relative position.
        const below = d.ancestors.slice(oldAncestorCount + 1);
        const ancestors = [...prefix, ...below];
        return { updateOne: { filter: { _id: d._id }, update: { $set: { ancestors, depth: ancestors.length } } } };
    });
    if (ops.length) await Category.bulkWrite(ops);

    const moved = [{ _id: category._id, ancestors: category.ancestors }, ...(await Category.find({ ancestors: category._id }).lean())];
    await Product.bulkWrite(
        moved.map((c) => ({
            updateMany: { filter: { category: c._id }, update: { $set: { categoryPath: [...c.ancestors, c._id] } } }
        }))
    );
};

export const updateCategory = async (id, { parent: parentId, ...fields }) => {
    const category = await getCategory(id);

    if (fields.name && fields.name !== category.name) {
        category.slug = await uniqueSlug(Category, fields.name, { module: category.module }, category._id);
    }
    Object.assign(category, fields);

    const parentChanged = parentId !== undefined && String(parentId ?? '') !== String(category.parent ?? '');
    if (!parentChanged) return category.save();

    const parent = await loadParent(parentId, category.module);
    if (parent && (String(parent._id) === String(category._id) || parent.ancestors.some((a) => String(a) === String(category._id)))) {
        throw new ValidationError('A category cannot be moved under itself');
    }

    const subtreeHeight = (await Category.find({ ancestors: category._id }).select('depth').lean())
        .reduce((max, d) => Math.max(max, d.depth - category.depth), 0);
    const newDepth = parent ? parent.depth + 1 : 0;
    if (newDepth + subtreeHeight > MAX_CATEGORY_DEPTH) {
        throw new ValidationError(`That move would nest categories deeper than ${MAX_CATEGORY_DEPTH + 1} levels`);
    }

    const oldAncestorCount = category.ancestors.length;
    category.parent = parent?._id ?? null;
    category.ancestors = parent ? [...parent.ancestors, parent._id] : [];
    category.depth = newDepth;
    await category.save();
    await reparentSubtree(category, oldAncestorCount);
    return category;
};

export const deleteCategory = async (id) => {
    const category = await getCategory(id);
    if (await Category.exists({ parent: category._id })) {
        throw new ConflictError('Delete or move its subcategories first');
    }
    if (await Product.exists({ categoryPath: category._id })) {
        throw new ConflictError('This category still has products; move them or deactivate the category instead');
    }
    await category.deleteOne();
};
