import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useCurrentModule } from '../lib/moduleContext.jsx';
import { formatPaise } from '../lib/money.js';
import { ErrorNote } from '../components/ui.jsx';

const REPORTS = [
    { type: 'orders', label: 'Order listing', dated: true, modules: ['grocery', 'produce', 'electronics'] },
    { type: 'sales', label: 'Sales summary', dated: true, modules: ['grocery', 'produce', 'electronics', 'laundry'] },
    { type: 'category-orders', label: 'Orders by category', dated: true, modules: ['grocery', 'produce', 'electronics'] },
    { type: 'availability', label: 'Product availability', dated: false, modules: ['grocery', 'produce', 'electronics'] },
    { type: 'bookings', label: 'Laundry bookings', dated: true, modules: [] }
];
const MODULE_NAMES = { grocery: 'Grocery', produce: 'Produce', laundry: 'Laundry', electronics: 'Electronics' };

/** IST calendar date n days ago. */
const istDaysAgo = (n) => new Date(Date.now() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10);

const display = (value, kind) => (kind === 'money' ? formatPaise(value) : value ?? '');
const PREVIEW_ROWS = 200;

export default function Reports() {
    const [type, setType] = useState('orders');
    const [from, setFrom] = useState(istDaysAgo(6));
    const [to, setTo] = useState(istDaysAgo(0));
    // Starts on the module the panel is focused on; the select can widen it to all.
    const { module: current } = useCurrentModule();
    const [module, setModule] = useState(current);
    useEffect(() => setModule(current), [current]);
    const [downloading, setDownloading] = useState('');
    const [downloadError, setDownloadError] = useState('');
    const report = REPORTS.find((r) => r.type === type);
    const params = { ...(report.dated ? { from, to } : {}), ...(module && report.modules.includes(module) ? { module } : {}) };

    const { data, isFetching, error } = useQuery({
        queryKey: ['report', type, params],
        queryFn: () => api.get(`/admin/reports/${type}`, { params }).then((r) => r.data.data)
    });

    const download = async (format) => {
        setDownloading(format);
        setDownloadError('');
        try {
            const res = await api.get(`/admin/reports/${type}`, { params: { ...params, format }, responseType: 'blob' });
            const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? `${type}.${format}`;
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setDownloadError(errorMessage(err, 'Download failed'));
        } finally {
            setDownloading('');
        }
    };

    const totals = data?.columns.filter((c) => c.kind === 'money' || c.kind === 'number').filter((c) => !['avgOrderPaise', 'lowAt', 'stock', 'pricePaise'].includes(c.key));

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Reports</h1>
                <p className="text-sm text-slate-500">Dates are Indian Standard Time. Download as CSV or Excel.</p>
            </div>

            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Report">
                {REPORTS.map((r) => (
                    <button
                        key={r.type}
                        type="button"
                        role="tab"
                        aria-selected={type === r.type}
                        onClick={() => setType(r.type)}
                        className={`rounded-full border px-3 py-1 text-sm ${type === r.type ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}
                    >
                        {r.label}
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
                {report.dated && (
                    <>
                        <div>
                            <label className="label" htmlFor="r-from">From</label>
                            <input id="r-from" type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
                        </div>
                        <div>
                            <label className="label" htmlFor="r-to">To</label>
                            <input id="r-to" type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                        </div>
                    </>
                )}
                {report.modules.length > 1 && (
                    <div>
                        <label className="label" htmlFor="r-module">Module</label>
                        <select id="r-module" className="input" value={module} onChange={(e) => setModule(e.target.value)}>
                            <option value="">All</option>
                            {report.modules.map((m) => <option key={m} value={m}>{MODULE_NAMES[m]}</option>)}
                        </select>
                    </div>
                )}
                <div className="ml-auto flex gap-2">
                    <button type="button" className="btn-ghost border border-slate-300" disabled={Boolean(downloading) || !data} onClick={() => download('csv')}>
                        {downloading === 'csv' ? 'Preparing…' : 'Download CSV'}
                    </button>
                    <button type="button" className="btn-primary" disabled={Boolean(downloading) || !data} onClick={() => download('xlsx')}>
                        {downloading === 'xlsx' ? 'Preparing…' : 'Download Excel'}
                    </button>
                </div>
            </div>

            <ErrorNote error={error || downloadError} />

            {data && (
                <>
                    <div className="flex flex-wrap gap-4 text-sm">
                        <span className="text-slate-600"><strong className="text-slate-900">{data.rows.length}</strong> rows</span>
                        {totals?.map((c) => (
                            <span key={c.key} className="text-slate-600">
                                {c.header}: <strong className="tabular-nums text-slate-900">{display(data.rows.reduce((s, r) => s + (r[c.key] ?? 0), 0), c.kind)}</strong>
                            </span>
                        ))}
                        {isFetching && <span className="text-slate-400">Updating…</span>}
                    </div>
                    <div className="card overflow-x-auto p-0">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-left text-slate-500">
                                <tr>{data.columns.map((c) => <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-medium ${c.kind !== 'text' ? 'text-right' : ''}`}>{c.header}</th>)}</tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 && <tr><td colSpan={data.columns.length} className="px-3 py-6 text-center text-slate-500">No data for these filters.</td></tr>}
                                {data.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                                    <tr key={i} className="border-t border-slate-100">
                                        {data.columns.map((c) => (
                                            <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.kind !== 'text' ? 'text-right tabular-nums' : ''}`}>{display(row[c.key], c.kind)}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {data.rows.length > PREVIEW_ROWS && <p className="text-xs text-slate-500">Showing the first {PREVIEW_ROWS} rows. Download for all {data.rows.length}.</p>}
                    {data.truncated && <p className="text-xs text-amber-700">This report hit the row limit; narrow the dates.</p>}
                </>
            )}
        </div>
    );
}
