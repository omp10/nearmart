import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { useCurrentModule } from '../lib/moduleContext.jsx';
import { formatPaise, paiseToRupees, rupeesToPaise } from '../lib/money.js';
import { Badge, ErrorNote, Modal, useModules } from '../components/ui.jsx';

const parsePincodes = (text) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];

const toForm = (z, module) => ({
    name: z?.name ?? '',
    isActive: z?.isActive ?? true,
    modules: z?.modules ?? [module],
    pincodes: (z?.pincodes ?? []).join(', '),
    polygon: z?.polygon?.type ? JSON.stringify(z.polygon) : '',
    priority: String(z?.priority ?? 0),
    minOrder: paiseToRupees(z?.minOrderPaise),
    deliveryFee: paiseToRupees(z?.deliveryFeePaise),
    freeAbove: paiseToRupees(z?.freeDeliveryAbovePaise)
});

/** Accepts a GeoJSON Polygon/MultiPolygon, or a Feature / FeatureCollection wrapping one (geojson.io exports those). */
const parsePolygon = (text) => {
    if (!text.trim()) return { polygon: null };
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        return { error: 'Map area is not valid JSON' };
    }
    const geometry = json.type === 'FeatureCollection' ? json.features?.[0]?.geometry : json.type === 'Feature' ? json.geometry : json;
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) return { error: 'Map area must be a GeoJSON Polygon' };
    return { polygon: { type: geometry.type, coordinates: geometry.coordinates } };
};

function ZoneForm({ zone, onDone }) {
    const queryClient = useQueryClient();
    const { data: modules = [] } = useModules();
    const { module } = useCurrentModule();
    const [form, setForm] = useState(() => toForm(zone, module));
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const save = useMutation({
        mutationFn: (body) => (zone?._id ? api.patch(`/admin/zones/${zone._id}`, body) : api.post('/admin/zones', body)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            onDone();
        }
    });

    const submit = (e) => {
        e.preventDefault();
        setFormError('');
        const { polygon, error } = parsePolygon(form.polygon);
        if (error) return setFormError(error);
        const money = { minOrderPaise: rupeesToPaise(form.minOrder), deliveryFeePaise: rupeesToPaise(form.deliveryFee), freeDeliveryAbovePaise: rupeesToPaise(form.freeAbove) };
        if (Object.values(money).some(Number.isNaN)) return setFormError('Charges must be numbers');
        return save.mutate({
            name: form.name,
            isActive: form.isActive,
            modules: form.modules,
            pincodes: parsePincodes(form.pincodes),
            polygon,
            priority: Number.parseInt(form.priority, 10) || 0,
            ...money
        });
    };

    const pinCount = parsePincodes(form.pincodes).length;

    return (
        <form onSubmit={submit} className="space-y-4">
            <ErrorNote error={formError || save.error} />
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <div>
                    <label className="label" htmlFor="z-name">Name</label>
                    <input id="z-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
                </div>
                <div>
                    <label className="label" htmlFor="z-priority">Priority</label>
                    <input id="z-priority" type="number" min="0" className="input" value={form.priority} onChange={(e) => set({ priority: e.target.value })} />
                </div>
            </div>

            <fieldset>
                <legend className="label">Modules served here</legend>
                <div className="flex flex-wrap gap-4">
                    {modules.map((m) => (
                        <label key={m.key} className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={form.modules.includes(m.key)}
                                onChange={(e) => set({ modules: e.target.checked ? [...form.modules, m.key] : form.modules.filter((k) => k !== m.key) })}
                            />
                            {m.name}
                        </label>
                    ))}
                </div>
            </fieldset>

            <div>
                <label className="label" htmlFor="z-pins">Pincodes <span className="font-normal text-slate-500">({pinCount})</span></label>
                <textarea id="z-pins" className="input font-mono" rows={3} placeholder="411038, 411029, 411052" value={form.pincodes} onChange={(e) => set({ pincodes: e.target.value })} />
            </div>

            <div>
                <label className="label" htmlFor="z-poly">Map area (optional GeoJSON)</label>
                <textarea
                    id="z-poly"
                    className="input font-mono text-xs"
                    rows={3}
                    placeholder='Draw at geojson.io and paste here: {"type":"Polygon","coordinates":[[[lng,lat],…]]}'
                    value={form.polygon}
                    onChange={(e) => set({ polygon: e.target.value })}
                />
                <p className="mt-1 text-xs text-slate-500">Addresses match if their pincode is listed or their map pin is inside this area.</p>
            </div>

            <fieldset className="grid gap-4 sm:grid-cols-3">
                <legend className="label">Delivery charges (₹, used at checkout)</legend>
                <div>
                    <label className="text-xs text-slate-500" htmlFor="z-min">Minimum order</label>
                    <input id="z-min" type="number" min="0" step="0.01" className="input" value={form.minOrder} onChange={(e) => set({ minOrder: e.target.value })} />
                </div>
                <div>
                    <label className="text-xs text-slate-500" htmlFor="z-fee">Delivery fee</label>
                    <input id="z-fee" type="number" min="0" step="0.01" className="input" value={form.deliveryFee} onChange={(e) => set({ deliveryFee: e.target.value })} />
                </div>
                <div>
                    <label className="text-xs text-slate-500" htmlFor="z-free">Free delivery above</label>
                    <input id="z-free" type="number" min="0" step="0.01" className="input" value={form.freeAbove} onChange={(e) => set({ freeAbove: e.target.value })} />
                </div>
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                Active
            </label>

            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </div>
        </form>
    );
}

function LocationCheck() {
    const [q, setQ] = useState({ pincode: '', lat: '', lng: '' });
    const check = useMutation({
        mutationFn: () =>
            api.post('/admin/zones/check', {
                ...(q.pincode ? { pincode: q.pincode.trim() } : {}),
                ...(q.lat && q.lng ? { lat: Number(q.lat), lng: Number(q.lng) } : {})
            }).then((r) => r.data.data)
    });

    return (
        <form
            className="card space-y-3"
            onSubmit={(e) => {
                e.preventDefault();
                check.mutate();
            }}
        >
            <h2 className="font-semibold">Check a location</h2>
            <div className="grid gap-3 sm:grid-cols-4">
                <input className="input" placeholder="Pincode" aria-label="Pincode" value={q.pincode} onChange={(e) => setQ({ ...q, pincode: e.target.value })} />
                <input className="input" placeholder="Latitude" aria-label="Latitude" value={q.lat} onChange={(e) => setQ({ ...q, lat: e.target.value })} />
                <input className="input" placeholder="Longitude" aria-label="Longitude" value={q.lng} onChange={(e) => setQ({ ...q, lng: e.target.value })} />
                <button type="submit" className="btn-primary" disabled={check.isPending}>Check</button>
            </div>
            <ErrorNote error={check.error} />
            {check.data && (
                <p className="text-sm" role="status">
                    {check.data.matches.length
                        ? <>Served by <strong>{check.data.matches.map((m) => m.name).join(', ')}</strong> · modules: {check.data.modules.join(', ') || 'none active'}</>
                        : 'Not in any active service area.'}
                </p>
            )}
        </form>
    );
}

export default function Zones() {
    const { can, user } = useAuth();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(null);
    const isAdmin = user.role === 'admin';
    const { module, modules } = useCurrentModule();
    const name = modules.find((m) => m.key === module)?.name ?? module;
    const { data: all = [], isLoading, error } = useQuery({
        queryKey: ['zones'],
        queryFn: () => api.get('/admin/zones').then((r) => r.data.data)
    });
    // An area can serve several modules; it shows under each of them.
    const zones = all.filter((zn) => zn.modules.includes(module));
    const remove = useMutation({
        mutationFn: (id) => api.delete(`/admin/zones/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['zones'] })
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Service areas</h1>
                    <p className="text-sm text-slate-500">Where each module delivers or picks up, by pincode and/or map area.</p>
                </div>
                {isAdmin && can('zones', 'create') && (
                    <button type="button" className="btn-primary" onClick={() => setEditing({})}>Add service area</button>
                )}
            </div>

            <ErrorNote error={error || remove.error} />

            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Name</th>
                            <th className="px-4 py-3 font-medium">Modules</th>
                            <th className="px-4 py-3 font-medium">Coverage</th>
                            <th className="px-4 py-3 font-medium">Delivery fee</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {!isLoading && zones.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No service areas deliver {name} yet. Customers can't order {name} until one does.</td></tr>
                        )}
                        {zones.map((zn) => (
                            <tr key={zn._id} className="border-t border-slate-100">
                                <td className="px-4 py-3 font-medium">
                                    {zn.name}
                                    {zn.priority > 0 && <span className="ml-2 text-xs text-slate-400">priority {zn.priority}</span>}
                                </td>
                                <td className="px-4 py-3 text-slate-600">{zn.modules.map((k) => modules.find((m) => m.key === k)?.name ?? k).join(', ')}</td>
                                <td className="px-4 py-3 text-slate-600">
                                    {zn.pincodes.length > 0 && <span>{zn.pincodes.length} pincode{zn.pincodes.length > 1 ? 's' : ''}</span>}
                                    {zn.pincodes.length > 0 && zn.polygon?.type && ' + '}
                                    {zn.polygon?.type && <span>map area</span>}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                    {zn.deliveryFeePaise != null ? formatPaise(zn.deliveryFeePaise) : '—'}
                                    {zn.freeDeliveryAbovePaise != null && <span className="block text-xs">free above {formatPaise(zn.freeDeliveryAbovePaise)}</span>}
                                </td>
                                <td className="px-4 py-3">{zn.isActive ? <Badge tone="green">Active</Badge> : <Badge>Off</Badge>}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                    {isAdmin && can('zones', 'update') && <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEditing(zn)}>Edit</button>}
                                    {isAdmin && can('zones', 'delete') && (
                                        <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => window.confirm(`Delete "${zn.name}"?`) && remove.mutate(zn._id)}>
                                            Delete
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <LocationCheck />

            <Modal open={Boolean(editing)} title={editing?._id ? 'Edit service area' : 'New service area'} onClose={() => setEditing(null)} wide>
                {editing && <ZoneForm zone={editing._id ? editing : null} onDone={() => setEditing(null)} />}
            </Modal>
        </div>
    );
}
