import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { Badge, ErrorNote, ImageUpload, Modal, ModuleTabs, flattenTree, useCategoryTree, useModules } from '../components/ui.jsx';

const MAX_DEPTH = 2; // must match MAX_CATEGORY_DEPTH in the backend

/** Ids of the node `id` and everything under it. */
const subtreeIds = (nodes, id) => {
    for (const n of nodes) {
        if (n._id === id) return flattenTree([n]).map((c) => c.id);
        const found = subtreeIds(n.children, id);
        if (found.length) return found;
    }
    return [];
};

function CategoryForm({ module, initial, tree, onDone }) {
    const queryClient = useQueryClient();
    const isEdit = Boolean(initial?._id);
    const [form, setForm] = useState({
        name: initial?.name ?? '',
        description: initial?.description ?? '',
        image: initial?.image ?? '',
        sortOrder: initial?.sortOrder ?? 0,
        isActive: initial?.isActive ?? true,
        parent: initial?.parent ?? null
    });
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    // A category can't go under itself or its own descendants (the API enforces depth too).
    const excluded = new Set(isEdit ? subtreeIds(tree, initial._id) : []);
    const parentOptions = flattenTree(tree).filter((c) => c.depth < MAX_DEPTH && !excluded.has(c.id));

    const save = useMutation({
        mutationFn: (body) =>
            isEdit ? api.patch(`/admin/catalog/categories/${initial._id}`, body) : api.post('/admin/catalog/categories', { ...body, module }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories', module] });
            onDone();
        }
    });

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                save.mutate({ ...form, sortOrder: Number(form.sortOrder) || 0 });
            }}
        >
            <ErrorNote error={save.error} />
            <div>
                <label className="label" htmlFor="c-name">Name</label>
                <input id="c-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
            </div>
            <div>
                <label className="label" htmlFor="c-parent">Parent</label>
                <select id="c-parent" className="input" value={form.parent ?? ''} onChange={(e) => set({ parent: e.target.value || null })}>
                    <option value="">— Top level —</option>
                    {parentOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                </select>
            </div>
            <div>
                <label className="label" htmlFor="c-desc">Description</label>
                <textarea id="c-desc" className="input" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
            </div>
            <div className="flex items-center gap-4">
                {form.image && <img src={form.image} alt="" className="h-16 w-16 rounded-lg border object-cover" />}
                <ImageUpload folder="categories" onUploaded={(image) => set({ image })} label={form.image ? 'Replace image' : 'Upload image'} />
                {form.image && <button type="button" className="btn-ghost" onClick={() => set({ image: '' })}>Remove</button>}
            </div>
            <div className="flex flex-wrap items-end gap-6">
                <div className="w-32">
                    <label className="label" htmlFor="c-sort">Sort order</label>
                    <input id="c-sort" type="number" className="input" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                    Visible to customers
                </label>
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </div>
        </form>
    );
}

function TreeRows({ nodes, onEdit, onAddChild, onDelete, can }) {
    return nodes.map((node) => (
        <div key={node._id}>
            <div className="flex items-center gap-3 border-t border-slate-100 py-2 pr-2" style={{ paddingLeft: `${node.depth * 1.5 + 0.75}rem` }}>
                {node.image ? (
                    <img src={node.image} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                    <div className="h-8 w-8 rounded bg-slate-100" />
                )}
                <span className="font-medium">{node.name}</span>
                {!node.isActive && <Badge>Hidden</Badge>}
                <div className="ml-auto flex gap-1">
                    {can('catalog', 'create') && node.depth < MAX_DEPTH && (
                        <button type="button" className="btn-ghost px-2 py-1" onClick={() => onAddChild(node)}>+ Sub</button>
                    )}
                    {can('catalog', 'update') && (
                        <button type="button" className="btn-ghost px-2 py-1" onClick={() => onEdit(node)}>Edit</button>
                    )}
                    {can('catalog', 'delete') && (
                        <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => onDelete(node)}>Delete</button>
                    )}
                </div>
            </div>
            <TreeRows nodes={node.children} onEdit={onEdit} onAddChild={onAddChild} onDelete={onDelete} can={can} />
        </div>
    ));
}

export default function Categories() {
    const { can, user } = useAuth();
    const queryClient = useQueryClient();
    const [module, setModule] = useState('grocery');
    const [editing, setEditing] = useState(null); // {} for new, a node to edit, or { parent } for a child
    const { data: tree = [], isLoading, error } = useCategoryTree(module);
    const { data: modules = [] } = useModules();
    const moduleRow = modules.find((m) => m.key === module);

    const remove = useMutation({
        mutationFn: (id) => api.delete(`/admin/catalog/categories/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories', module] })
    });
    const toggleModule = useMutation({
        mutationFn: (isActive) => api.patch(`/admin/catalog/modules/${module}`, { isActive }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['modules'] })
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Categories</h1>
                    <p className="text-sm text-slate-500">Up to three levels: category › subcategory › sub-subcategory.</p>
                </div>
                {can('catalog', 'create') && (
                    <button type="button" className="btn-primary" onClick={() => setEditing({})}>Add category</button>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <ModuleTabs value={module} onChange={setModule} />
                {moduleRow && user.role === 'admin' && can('catalog', 'update') && (
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={moduleRow.isActive}
                            disabled={toggleModule.isPending}
                            onChange={(e) => toggleModule.mutate(e.target.checked)}
                        />
                        {moduleRow.name} is open to customers
                    </label>
                )}
            </div>

            <ErrorNote error={error || remove.error || toggleModule.error} />

            <div className="card p-0">
                {isLoading && <p className="p-5 text-sm text-slate-500">Loading…</p>}
                {!isLoading && tree.length === 0 && <p className="p-5 text-sm text-slate-500">No categories yet in this module.</p>}
                <TreeRows
                    nodes={tree}
                    can={can}
                    onEdit={(node) => setEditing(node)}
                    onAddChild={(node) => setEditing({ parent: node._id })}
                    onDelete={(node) => {
                        if (window.confirm(`Delete "${node.name}"?`)) remove.mutate(node._id);
                    }}
                />
            </div>

            <Modal open={Boolean(editing)} title={editing?._id ? 'Edit category' : 'New category'} onClose={() => setEditing(null)}>
                {editing && <CategoryForm module={module} initial={editing} tree={tree} onDone={() => setEditing(null)} />}
            </Modal>
        </div>
    );
}
