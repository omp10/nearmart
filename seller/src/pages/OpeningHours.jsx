import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CalendarOff, Check, Clock, Copy, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../lib/api.js';
import { isoDay } from '../lib/format.js';
import { DAY_NAMES, WEEK_ORDER, formatHoliday, groupByDay, rangeKind } from '../lib/hours.js';
import { ErrorNote, Notice, PageHeader } from '../components/ui.jsx';

const DEFAULT_RANGE = { open: '09:00', close: '21:00' };

function RangeHint({ open, close }) {
    const kind = rangeKind(open, close);
    if (kind === 'overnight') return <span className="text-xs text-amber-700">closes after midnight</span>;
    if (kind === 'allDay') return <span className="text-xs text-brand-700">open 24 hours</span>;
    return null;
}

function DayRow({ day, ranges, onChange, onCopyToAll }) {
    const open = ranges.length > 0;
    const setRange = (i, patch) => onChange(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    return (
        <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start">
            <div className="flex w-44 shrink-0 items-center gap-3">
                <button
                    type="button"
                    role="switch"
                    aria-checked={open}
                    aria-label={`${DAY_NAMES[day]} open`}
                    onClick={() => onChange(open ? [] : [{ ...DEFAULT_RANGE }])}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${open ? 'bg-brand-700' : 'bg-slate-300'}`}
                >
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${open ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm font-medium text-slate-900">{DAY_NAMES[day]}</span>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
                {!open && <p className="pt-0.5 text-sm text-slate-500">Closed all day</p>}
                {ranges.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                        <input type="time" step="60" className="input w-32" aria-label={`${DAY_NAMES[day]} opens at`} value={r.open} onChange={(e) => setRange(i, { open: e.target.value })} required />
                        <span className="text-sm text-slate-500">to</span>
                        <input type="time" step="60" className="input w-32" aria-label={`${DAY_NAMES[day]} closes at`} value={r.close} onChange={(e) => setRange(i, { close: e.target.value })} required />
                        <RangeHint {...r} />
                        <button type="button" className="btn-ghost px-2 py-1 text-slate-500" aria-label="Remove these hours" onClick={() => onChange(ranges.filter((_, j) => j !== i))}>
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                ))}
                {open && (
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onChange([...ranges, { open: '17:00', close: '21:00' }])}>
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            Add a break / second shift
                        </button>
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onCopyToAll}>
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            Use for every day
                        </button>
                    </div>
                )}
            </div>
        </li>
    );
}

/** Weekly hours and holidays (PUT /seller/store/hours). No hours = always open, only the switch applies. */
export default function OpeningHours() {
    const { seller, setSeller } = useAuth();
    const [mode, setMode] = useState(() => (seller.hours?.length ? 'weekly' : 'always'));
    const [days, setDays] = useState(() => {
        const grouped = groupByDay(seller.hours);
        if (!seller.hours?.length) WEEK_ORDER.forEach((d) => { grouped[d] = [{ ...DEFAULT_RANGE }]; });
        return grouped;
    });
    const [holidays, setHolidays] = useState(() => [...(seller.holidays ?? [])].sort());
    const [newHoliday, setNewHoliday] = useState('');
    const [localError, setLocalError] = useState('');
    const today = isoDay();

    const save = useMutation({
        mutationFn: (body) => api.put('/seller/store/hours', body).then((r) => r.data.data),
        onSuccess: setSeller
    });

    const setDay = (day, ranges) => {
        save.reset();
        setDays((d) => ({ ...d, [day]: ranges }));
    };
    const copyToAll = (day) => {
        save.reset();
        setDays(Object.fromEntries(DAY_NAMES.map((_, i) => [i, days[day].map((r) => ({ ...r }))])));
    };

    const addHoliday = () => {
        setLocalError('');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newHoliday)) return setLocalError('Pick a date to add.');
        if (holidays.includes(newHoliday)) return setLocalError('That date is already in the list.');
        if (holidays.length >= 60) return setLocalError('You can list up to 60 holidays. Remove past ones first.');
        save.reset();
        setHolidays((h) => [...h, newHoliday].sort());
        return setNewHoliday('');
    };
    const removeHoliday = (d) => {
        save.reset();
        setHolidays((h) => h.filter((x) => x !== d));
    };

    const onSubmit = (e) => {
        e.preventDefault();
        setLocalError('');
        let hours = [];
        if (mode === 'weekly') {
            hours = WEEK_ORDER.flatMap((day) => days[day].map((r) => ({ day, open: r.open, close: r.close })));
            if (hours.some((h) => rangeKind(h.open, h.close) === 'invalid')) return setLocalError('Fill in every opening and closing time (HH:MM, 24-hour).');
            if (!hours.length) return setLocalError('Every day is closed. Open at least one day, or choose "Always open".');
            if (hours.length > 21) return setLocalError('At most 21 time ranges in a week.');
        }
        return save.mutate({ hours, holidays });
    };

    const upcoming = holidays.filter((d) => d >= today);
    const past = holidays.filter((d) => d < today);

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <PageHeader
                back={<Link to="/store" className="text-sm text-slate-500 hover:underline">← Store profile</Link>}
                title="Opening hours"
                subtitle="When customers can order from you. Outside these hours your products are hidden, even with the store switch on."
            />

            <section className="card space-y-4">
                <h2 className="text-lg font-semibold">Weekly hours</h2>
                <fieldset className="grid gap-2 sm:grid-cols-2">
                    <legend className="sr-only">How your hours work</legend>
                    {[
                        { key: 'always', title: 'Always open', text: 'No set hours. Only your Open/Closed switch on the dashboard decides.' },
                        { key: 'weekly', title: 'Set weekly hours', text: 'Open only at these times, as long as the switch is on.' }
                    ].map((o) => (
                        <label key={o.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${mode === o.key ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200'}`}>
                            <input type="radio" name="hours-mode" className="mt-1 accent-brand-700" checked={mode === o.key} onChange={() => { save.reset(); setMode(o.key); }} />
                            <span>
                                <span className="block text-sm font-medium text-slate-900">{o.title}</span>
                                <span className="block text-xs text-slate-500">{o.text}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>

                {mode === 'weekly' ? (
                    <>
                        <ul className="divide-y divide-slate-100">
                            {WEEK_ORDER.map((day) => (
                                <DayRow key={day} day={day} ranges={days[day]} onChange={(r) => setDay(day, r)} onCopyToAll={() => copyToAll(day)} />
                            ))}
                        </ul>
                        <p className="text-xs text-slate-500">
                            Times are India time, 24-hour. A closing time earlier than the opening time means you close after midnight (e.g. 18:00 to 02:00).
                            The same opening and closing time means open 24 hours.
                        </p>
                    </>
                ) : (
                    <Notice tone="blue" icon={Clock}>
                        Your store follows only the Open/Closed switch on the dashboard. Saving this clears any weekly hours you set before.
                    </Notice>
                )}
            </section>

            <section className="card space-y-4">
                <div>
                    <h2 className="text-lg font-semibold">Holidays</h2>
                    <p className="text-sm text-slate-500">Days your store is closed all day, whatever your weekly hours say.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <div>
                        <label className="label" htmlFor="holiday-date">Date</label>
                        <input id="holiday-date" type="date" className="input" min={today} value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} />
                    </div>
                    <button type="button" className="btn-outline" onClick={addHoliday} disabled={!newHoliday}>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add holiday
                    </button>
                </div>
                {holidays.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 px-4 py-4 text-center text-sm text-slate-500">No holidays listed.</p>
                ) : (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {[...upcoming, ...past].map((d) => (
                            <li key={d} className="flex items-center gap-3 px-4 py-2.5">
                                <CalendarOff className={`h-4 w-4 shrink-0 ${d < today ? 'text-slate-300' : 'text-amber-600'}`} aria-hidden="true" />
                                <span className={`flex-1 text-sm ${d < today ? 'text-slate-400' : 'text-slate-800'}`}>
                                    {formatHoliday(d)}
                                    {d === today && <span className="ml-2 text-xs font-medium text-amber-700">today</span>}
                                    {d < today && <span className="ml-2 text-xs">past</span>}
                                </span>
                                <button type="button" className="btn-ghost px-2 py-1 text-red-600" onClick={() => removeHoliday(d)} aria-label={`Remove ${formatHoliday(d)}`}>
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <div className="flex flex-wrap items-center justify-end gap-3">
                <ErrorNote error={localError || save.error} />
                {save.isSuccess && !save.isPending && (
                    <span className="flex items-center gap-1 text-sm text-brand-700" role="status">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Saved. {save.data?.tradingNow ? 'Your store is taking orders now.' : 'Your store is not taking orders right now.'}
                    </span>
                )}
                <button type="submit" className="btn-primary px-6" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save opening hours'}</button>
            </div>
        </form>
    );
}
