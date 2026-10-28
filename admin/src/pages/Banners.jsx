import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { useCurrentModule } from '../lib/moduleContext.jsx';
import { Badge, ErrorNote, ImageUpload, Modal, useModules } from '../components/ui.jsx';

const toLocalInput = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

const LINK_TYPES = [
    ['none', 'Nothing'],
    ['module', 'A module'],
    ['category', 'A category (id)'],
    ['product', 'A product (id)'],
    ['url', 'A web page (https)']
];

/**
 * Grabs a frame (about 1 s in) from an uploaded video as a JPEG, so a banner
 * with only a video still gets the cover image the app shows while it loads.
 * Uploads are same-origin, so the canvas can be read.
 */
const frameFromVideo = (url) =>
    new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        v.addEventListener('loadeddata', () => {
            v.currentTime = Math.min(1, (v.duration || 2) / 2);
        });
        v.addEventListener('seeked', () => {
            const canvas = document.createElement('canvas');
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            canvas.getContext('2d').drawImage(v, 0, 0);
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No frame'))), 'image/jpeg', 0.9);
        });
        v.addEventListener('error', () => reject(new Error('Could not read the video')));
        v.src = url;
    });

const uploadCover = async (videoUrl) => {
    const form = new FormData();
    form.append('file', await frameFromVideo(videoUrl), 'cover.jpg');
    const res = await api.post('/uploads/image', form, { params: { folder: 'banners' } });
    return res.data.data.url;
};

const liveState = (b) => {
    const now = Date.now();
    if (!b.isActive) return <Badge>Off</Badge>;
    if (b.endsAt && new Date(b.endsAt) <= now) return <Badge tone="red">Ended</Badge>;
    if (b.startsAt && new Date(b.startsAt) > now) return <Badge tone="amber">Scheduled</Badge>;
    return <Badge tone="green">Live</Badge>;
};

function BannerForm({ banner, placement, onDone }) {
    const queryClient = useQueryClient();
    const { data: modules = [] } = useModules();
    const [form, setForm] = useState({
        title: banner?.title ?? '',
        image: banner?.image ?? '',
        video: banner?.video ?? '',
        placement: banner?.placement ?? placement,
        linkType: banner?.link?.type ?? 'none',
        linkValue: banner?.link?.value ?? '',
        sortOrder: String(banner?.sortOrder ?? 0),
        isActive: banner?.isActive ?? true,
        startsAt: toLocalInput(banner?.startsAt),
        endsAt: toLocalInput(banner?.endsAt)
    });
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const [cover, setCover] = useState('');
    // A video without a cover image gets one taken from the video itself.
    const onVideo = async (video) => {
        set({ video });
        if (form.image) return;
        setCover('Making a cover image from the video…');
        try {
            set({ image: await uploadCover(video) });
            setCover('');
        } catch {
            setCover("Couldn't take a cover from the video. Upload an image above.");
        }
    };
    const save = useMutation({
        mutationFn: (body) => (banner ? api.patch(`/admin/banners/${banner._id}`, body) : api.post('/admin/banners', body)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['banners'] });
            onDone();
        }
    });

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                save.mutate({
                    title: form.title,
                    image: form.image,
                    video: form.video,
                    placement: form.placement,
                    link: { type: form.linkType, value: form.linkType === 'none' ? '' : form.linkValue },
                    sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
                    isActive: form.isActive,
                    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
                    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null
                });
            }}
        >
            <ErrorNote error={save.error} />
            <div>
                <label className="label" htmlFor="bn-title">Title (for staff, and alt text in the app)</label>
                <input id="bn-title" className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} required maxLength={100} />
            </div>
            <div className="space-y-2">
                <span className="label">Image (also the cover while a video loads)</span>
                {form.image && <img src={form.image} alt="" className="aspect-[2/1] w-full rounded-lg border object-cover" />}
                <ImageUpload folder="banners" onUploaded={(image) => set({ image })} label={form.image ? 'Replace image' : 'Upload image or GIF (1600 × 800, 2:1)'} />
            </div>
            <div className="space-y-2">
                <span className="label">Video (optional)</span>
                <p className="text-xs text-slate-500">MP4 or WebM, 2:1, a few seconds, up to 25 MB. It plays muted on a loop in place of the image.</p>
                {form.video && <video src={form.video} poster={form.image || undefined} className="aspect-[2/1] w-full rounded-lg border object-cover" muted loop autoPlay playsInline />}
                <div className="flex flex-wrap items-start gap-2">
                    <ImageUpload kind="video" folder="banners" onUploaded={onVideo} label={form.video ? 'Replace video' : 'Upload video'} />
                    {form.video && <button type="button" className="btn-ghost text-red-600" onClick={() => set({ video: '' })}>Remove video</button>}
                </div>
                {cover && <p className="text-xs text-slate-600">{cover}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="bn-place">Where</label>
                    <select id="bn-place" className="input" value={form.placement} onChange={(e) => set({ placement: e.target.value })}>
                        <option value="home">Home screen</option>
                        {modules.map((m) => <option key={m.key} value={m.key}>{m.name} page</option>)}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="bn-sort">Order</label>
                    <input id="bn-sort" type="number" className="input" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="bn-link">On tap, open</label>
                    <select id="bn-link" className="input" value={form.linkType} onChange={(e) => set({ linkType: e.target.value, linkValue: '' })}>
                        {LINK_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                </div>
                {form.linkType === 'module' && (
                    <div>
                        <label className="label" htmlFor="bn-mod">Module</label>
                        <select id="bn-mod" className="input" value={form.linkValue} onChange={(e) => set({ linkValue: e.target.value })} required>
                            <option value="" disabled>Choose</option>
                            {modules.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                        </select>
                    </div>
                )}
                {['category', 'product', 'url'].includes(form.linkType) && (
                    <div>
                        <label className="label" htmlFor="bn-val">{form.linkType === 'url' ? 'URL' : `${form.linkType} id`}</label>
                        <input id="bn-val" className="input font-mono text-xs" value={form.linkValue} placeholder={form.linkType === 'url' ? 'https://' : 'Copy from the address bar of its edit page'} onChange={(e) => set({ linkValue: e.target.value })} required />
                    </div>
                )}
                <div>
                    <label className="label" htmlFor="bn-start">Show from</label>
                    <input id="bn-start" type="datetime-local" className="input" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
                </div>
                <div>
                    <label className="label" htmlFor="bn-end">Until</label>
                    <input id="bn-end" type="datetime-local" className="input" value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
                </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                Active
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
                {!form.image && <p className="mr-auto text-sm text-amber-700">Add an image to save: it's the banner, or the cover for a video.</p>}
                <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={save.isPending || !form.image}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </div>
        </form>
    );
}

export default function Banners() {
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(null);
    const { module, modules, isGlobal } = useCurrentModule();
    const name = modules.find((m) => m.key === module)?.name ?? module;
    // Each module's page has its own banners; the app's home screen, shared by all modules, lives under Global.
    const placement = isGlobal ? 'home' : module;
    const { data: all = [], isLoading, error } = useQuery({ queryKey: ['banners'], queryFn: () => api.get('/admin/banners').then((r) => r.data.data) });
    const banners = all.filter((b) => b.placement === placement);
    const remove = useMutation({ mutationFn: (id) => api.delete(`/admin/banners/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['banners'] }) });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Banners</h1>
                    <p className="text-sm text-slate-500">{isGlobal ? "Promotions on the app's home screen, which every module shares. Each module's own page banners are under its tab." : `Promotions on the app's ${name} page. Home screen banners are under Global.`}</p>
                </div>
                {can('banners', 'create') && <button type="button" className="btn-primary" onClick={() => setEditing({})}>Add banner</button>}
            </div>
            <ErrorNote error={error || remove.error} />
            {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {!isLoading && banners.length === 0 && <p className="text-sm text-slate-500">No banners here yet.</p>}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {banners.map((b) => (
                    <div key={b._id} className="card space-y-2 p-3">
                        {b.video ? (
                            <video src={b.video} poster={b.image} className="aspect-[2/1] w-full rounded-lg object-cover" muted loop autoPlay playsInline />
                        ) : (
                            <img src={b.image} alt={b.title} className="aspect-[2/1] w-full rounded-lg object-cover" />
                        )}
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <p className="font-medium">{b.title}</p>
                                <p className="text-xs text-slate-500">{b.placement === 'home' ? 'Home' : b.placement} · order {b.sortOrder}{b.link?.type !== 'none' && ` · opens ${b.link.type}`}</p>
                            </div>
                            {liveState(b)}
                        </div>
                        <div className="flex justify-end gap-1">
                            {can('banners', 'update') && <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEditing(b)}>Edit</button>}
                            {can('banners', 'delete') && (
                                <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => window.confirm(`Delete "${b.title}"?`) && remove.mutate(b._id)}>Delete</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <Modal open={Boolean(editing)} title={editing?._id ? 'Edit banner' : 'New banner'} onClose={() => setEditing(null)} wide>
                {editing && <BannerForm banner={editing._id ? editing : null} placement={placement} onDone={() => setEditing(null)} />}
            </Modal>
        </div>
    );
}
