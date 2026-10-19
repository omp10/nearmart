import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { formatPaise, paiseToRupees, rupeesToPaise } from '../lib/money.js';
import { Badge, ErrorNote, ImageUpload, Modal } from '../components/ui.jsx';

function ServiceForm({ service, onDone }) {
    const queryClient = useQueryClient();
    const [form, setForm] = useState({
        name: service?.name ?? '',
        description: service?.description ?? '',
        image: service?.image ?? '',
        pricingUnit: service?.pricingUnit ?? 'kg',
        rate: paiseToRupees(service?.ratePaise),
        minQty: String(service?.minQty ?? 1),
        turnaroundHours: String(service?.turnaroundHours ?? 48),
        gstRate: service?.gstRate ?? 18,
        sortOrder: String(service?.sortOrder ?? 0),
        isActive: service?.isActive ?? true
    });
    const [formError, setFormError] = useState('');
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));

    const save = useMutation({
        mutationFn: (body) => (service ? api.patch(`/admin/laundry/services/${service._id}`, body) : api.post('/admin/laundry/services', body)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['laundry-services'] });
            onDone();
        }
    });

    const submit = (e) => {
        e.preventDefault();
        const ratePaise = rupeesToPaise(form.rate);
        if (!ratePaise || Number.isNaN(ratePaise)) return setFormError('Enter a rate');
        setFormError('');
        return save.mutate({
            name: form.name,
            description: form.description,
            image: form.image,
            pricingUnit: form.pricingUnit,
            ratePaise,
            minQty: Number(form.minQty) || 0,
            turnaroundHours: Number.parseInt(form.turnaroundHours, 10) || 48,
            gstRate: Number(form.gstRate),
            sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
            isActive: form.isActive
        });
    };

    const unit = form.pricingUnit === 'kg' ? 'kg' : 'piece';
    return (
        <form onSubmit={submit} className="space-y-4">
            <ErrorNote error={formError || save.error} />
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                    <label className="label" htmlFor="ls-name">Name</label>
                    <input id="ls-name" className="input" placeholder="Wash & Fold" value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
                </div>
                <div className="sm:col-span-2">
                    <label className="label" htmlFor="ls-desc">Description</label>
                    <textarea id="ls-desc" className="input" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
                </div>
                <div>
                    <label className="label" htmlFor="ls-unit">Priced per</label>
                    <select id="ls-unit" className="input" value={form.pricingUnit} onChange={(e) => set({ pricingUnit: e.target.value })}>
                        <option value="kg">kg (weighed)</option>
                        <option value="piece">piece (counted)</option>
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="ls-rate">Rate (₹ per {unit})</label>
                    <input id="ls-rate" className="input" type="number" min="0" step="0.01" value={form.rate} onChange={(e) => set({ rate: e.target.value })} required />
                </div>
                <div>
                    <label className="label" htmlFor="ls-min">Minimum billed ({unit})</label>
                    <input id="ls-min" className="input" type="number" min="0" step="0.1" value={form.minQty} onChange={(e) => set({ minQty: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="ls-tat">Turnaround (hours)</label>
                    <input id="ls-tat" className="input" type="number" min="1" value={form.turnaroundHours} onChange={(e) => set({ turnaroundHours: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="ls-gst">GST (included)</label>
                    <select id="ls-gst" className="input" value={form.gstRate} onChange={(e) => set({ gstRate: Number(e.target.value) })}>
                        {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="ls-sort">Sort order</label>
                    <input id="ls-sort" className="input" type="number" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
                </div>
            </div>
            <div className="flex items-center gap-4">
                {form.image && <img src={form.image} alt="" className="h-16 w-16 rounded-lg border object-cover" />}
                <ImageUpload folder="services" onUploaded={(image) => set({ image })} label={form.image ? 'Replace image' : 'Upload image'} />
            </div>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                Offered to customers
            </label>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </div>
        </form>
    );
}

export default function LaundryServices() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(null);
    const { data: services = [], isLoading, error } = useQuery({
        queryKey: ['laundry-services'],
        queryFn: () => api.get('/admin/laundry/services').then((r) => r.data.data)
    });
    const remove = useMutation({
        mutationFn: (id) => api.delete(`/admin/laundry/services/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['laundry-services'] })
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Laundry services</h1>
                    <p className="text-sm text-slate-500">The price chart customers book from. Final prices use the weighed or counted quantity.</p>
                </div>
                {can('catalog', 'create') && <button type="button" className="btn-primary" onClick={() => setEditing({})}>Add service</button>}
            </div>
            <ErrorNote error={error || remove.error} />
            <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                            <th className="px-4 py-3 font-medium">Service</th>
                            <th className="px-4 py-3 font-medium">Rate</th>
                            <th className="px-4 py-3 font-medium">Minimum</th>
                            <th className="px-4 py-3 font-medium">Turnaround</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
                        {!isLoading && services.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No services yet.</td></tr>}
                        {services.map((s) => (
                            <tr key={s._id} className="border-t border-slate-100">
                                <td className="px-4 py-3">
                                    <span className="font-medium">{s.name}</span>
                                    {s.description && <span className="block text-xs text-slate-500">{s.description}</span>}
                                </td>
                                <td className="px-4 py-3 tabular-nums">{formatPaise(s.ratePaise)} / {s.pricingUnit}</td>
                                <td className="px-4 py-3">{s.minQty} {s.pricingUnit}</td>
                                <td className="px-4 py-3">{s.turnaroundHours} h</td>
                                <td className="px-4 py-3">{s.isActive ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                    {can('catalog', 'update') && <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEditing(s)}>Edit</button>}
                                    {can('catalog', 'delete') && (
                                        <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => window.confirm(`Delete ${s.name}?`) && remove.mutate(s._id)}>Delete</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <Modal open={Boolean(editing)} title={editing?._id ? `Edit ${editing.name}` : 'New service'} onClose={() => setEditing(null)} wide>
                {editing && <ServiceForm service={editing._id ? editing : null} onDone={() => setEditing(null)} />}
            </Modal>
        </div>
    );
}
