import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  Clock,
  Download,
  History,
  Loader2,
  Package,
  Search,
  TrendingUp,
  Trash2,
  FileText,
} from 'lucide-react';
import { listMonitoringRecords, deleteMonitoringRecord, type MonitoringRecord } from '@/lib/monitoring';
import { formatDuration, formatEventDate, formatEventTime } from '@/lib/downtime';
import { SHIFT_LABELS, SHIFT_LIST, type Shift, type ShiftRow } from '@/types';
import { PageHelp } from '@/components/PageHelp';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const QUALITY_LABELS = ['Pending', 'Pass', 'Fail'];
const SAFETY_LABELS = ['Pending', 'Safe', 'Issue'];

export function RecordHistory({
  date,
  onDateChange,
}: {
  date: string;
  onDateChange: (date: string) => void;
}) {
  const [searchDate, setSearchDate] = useState(date || todayStr());
  const [records, setRecords] = useState<MonitoringRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadRecords = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMonitoringRecords(d);
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved records');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords(searchDate);
  }, [loadRecords, searchDate]);

  const handleSearch = useCallback(() => {
    onDateChange(searchDate);
    loadRecords(searchDate);
  }, [searchDate, onDateChange, loadRecords]);

  const handleDelete = useCallback(async (record: MonitoringRecord) => {
    if (!confirm(`Delete the saved record for ${record.shift_name} on ${record.record_date}? This cannot be undone.`)) {
      return;
    }
    setDeletingId(record.id);
    try {
      await deleteMonitoringRecord(record.record_date, record.shift_name as Shift);
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete record');
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleExportRecord = useCallback((record: MonitoringRecord) => {
    const original = document.title;
    document.title = `FF_${record.shift_name}_${record.record_date}`;
    const restore = () => {
      document.title = original;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.setTimeout(restore, 60_000);
    window.print();
  }, []);

  const sortedRecords = useMemo(() => {
    const order = SHIFT_LIST;
    return [...records].sort((a, b) => {
      const ai = order.indexOf(a.shift_name as Shift);
      const bi = order.indexOf(b.shift_name as Shift);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [records]);

  const dateLabel = searchDate === todayStr() ? 'Today' : searchDate;

  return (
    <div>
      <PageHelp
        title="Record History"
        intro="Browse all saved monitoring records for a given date. Each record is a complete snapshot of the shift board — rows, notes, SKU, active job, downtime events, and counter readings — captured when someone clicked Save Record on the monitoring page."
        sections={[
          {
            title: 'Searching for records',
            items: [
              'Pick a date using the date picker, or use the Today or Yesterday buttons as shortcuts.',
              'Click Search to load all saved records for that date.',
              'Records appear as cards, one per shift. The shift name, save time, and a quick summary are shown.',
            ],
          },
          {
            title: 'Viewing a record in detail',
            items: [
              'Click a card to expand it and see the full shift board — every row with speed, output, downtime logs, yield, scrap, quality, and safety.',
              'The active job snapshot (product, target quantity, produced, progress) appears below the board.',
              'Downtime events and counter readings captured at save time are shown in their own sections.',
            ],
          },
          {
            title: 'Exporting and deleting',
            items: [
              'Click Export to print or save the expanded record as a PDF.',
              'Click Delete to permanently remove a saved record. You will be asked to confirm first.',
            ],
          },
        ]}
      />

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3 no-print">
        <div className="flex items-center gap-2">
          <History className="text-brand-900" size={22} />
          <h2 className="text-lg font-bold text-brand-900 m-0">Saved Record History</h2>
        </div>
      </div>

      <div className="card rounded-lg p-4 mb-4 border border-slate-200 bg-white">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
              Date
            </label>
            <div className="flex items-center gap-2 border border-slate-300 rounded-md px-3 py-2 bg-white">
              <Calendar size={16} className="text-slate-400" />
              <input
                type="date"
                value={searchDate}
                max={todayStr()}
                onChange={(e) => setSearchDate(e.target.value)}
                className="border-none bg-transparent text-[14px] font-semibold text-slate-800 outline-none"
              />
            </div>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-bold text-white bg-brand-700 hover:bg-brand-800 transition-colors"
            onClick={handleSearch}
            disabled={loading}
          >
            <Search size={14} />
            Search
          </button>
          <div className="flex items-end gap-1.5">
            <button
              type="button"
              className="px-3 py-2 rounded-md text-[12px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              onClick={() => setSearchDate(todayStr())}
            >
              Today
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-md text-[12px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                setSearchDate(dateToStr(d));
              }}
            >
              Yesterday
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg p-4 mb-4 border border-red-200 bg-red-50 text-red-800">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div className="text-[13px]">
            <p className="font-bold m-0 mb-1">Couldn't load saved records</p>
            <p className="m-0 text-red-700">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 size={24} className="animate-spin" />
          <span className="ml-2 text-[13px] font-medium">Loading…</span>
        </div>
      ) : sortedRecords.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <Calendar size={32} className="mb-2 opacity-50" />
          <p className="text-[13px] font-medium m-0">
            No saved records for {dateLabel}
          </p>
          <p className="text-[11px] m-0 mt-1 text-slate-400">
            Save a record from the Monitoring page to see it here
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedRecords.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              isExpanded={expandedId === record.id}
              onToggle={() => setExpandedId(expandedId === record.id ? null : record.id)}
              onDelete={() => handleDelete(record)}
              onExport={() => handleExportRecord(record)}
              isDeleting={deletingId === record.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecordCard({
  record,
  isExpanded,
  onToggle,
  onDelete,
  onExport,
  isDeleting,
}: {
  record: MonitoringRecord;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onExport: () => void;
  isDeleting: boolean;
}) {
  const boardData = record.board_data;
  const rows = boardData?.rows ?? {};
  const rowEntries = Object.entries(rows) as [string, ShiftRow][];
  const activeJob = record.active_job;
  const downtimeEvents = record.downtime_snapshot ?? [];
  const counterLogs = record.counter_snapshot ?? [];

  const totalOutput = rowEntries.reduce((sum, [, r]) => sum + (parseFloat((r.out || '').replace(/,/g, '')) || 0), 0);
  const filledRows = rowEntries.filter(([, r]) => r.spd || r.out).length;
  const downtimeCount = downtimeEvents.length;
  const totalDowntimeMs = downtimeEvents.reduce((s, e) => s + (e.duration_ms ?? 0), 0);

  const shiftLabel = SHIFT_LABELS[record.shift_name as Shift] ?? record.shift_name;

  return (
    <div className="card rounded-lg border border-slate-200 bg-white overflow-hidden">
      {/* Card header — always visible */}
      <div
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors no-print"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${isExpanded ? 'bg-brand-700 text-white' : 'bg-brand-100 text-brand-700'}`}>
            <Clock size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-bold text-slate-800 truncate">{shiftLabel}</h3>
            <p className="m-0 text-[11px] text-slate-500 mt-0.5">
              Saved {new Date(record.updated_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {record.saved_by ? ` by ${record.saved_by}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-[11px] font-semibold text-slate-500 mr-2">
            <span>{filledRows} rows</span>
            <span>{downtimeCount} downtime</span>
            <span>{(totalOutput / 1000).toFixed(1)}k out</span>
          </div>
          <ChevronDown
            size={18}
            className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-slate-200">
          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 no-print">
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold text-white bg-brand-700 hover:bg-brand-800 transition-colors"
              onClick={onExport}
            >
              <Download size={13} />
              Export
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
              onClick={onDelete}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Delete
            </button>
          </div>

          {/* SKU & Notes */}
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">SKU</span>
                <p className="m-0 text-[13px] font-semibold text-slate-700 mt-0.5">{record.sku || '—'}</p>
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Notes</span>
                <p className="m-0 text-[13px] text-slate-700 mt-0.5 whitespace-pre-wrap">{record.notes || '—'}</p>
              </div>
            </div>
          </div>

          {/* Active Job */}
          {activeJob && activeJob.productName && (
            <div className="px-4 py-3 border-b border-slate-100 bg-blue-50/50">
              <div className="flex items-center gap-2 mb-2">
                <Package size={14} className="text-brand-700" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-brand-700">Active Job at Save Time</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <JobStat label="Product" value={activeJob.productName} />
                <JobStat label="Target Qty" value={activeJob.targetQuantity.toLocaleString()} />
                <JobStat label="Produced" value={activeJob.produced.toLocaleString()} />
                <JobStat label="Progress" value={`${activeJob.progress.toFixed(1)}%`} />
              </div>
            </div>
          )}

          {/* Shift Board Table */}
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-slate-600" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Shift Board</span>
            </div>
            {rowEntries.length === 0 ? (
              <p className="text-[13px] text-slate-400 m-0">No board rows in this record.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                      <th className="px-2 py-2">Hour</th>
                      <th className="px-2 py-2 text-right">Speed</th>
                      <th className="px-2 py-2 text-right">Output</th>
                      <th className="px-2 py-2">Downtime Log</th>
                      <th className="px-2 py-2 text-right">Yield</th>
                      <th className="px-2 py-2 text-right">Scrap</th>
                      <th className="px-2 py-2 text-center">Q</th>
                      <th className="px-2 py-2 text-center">S</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowEntries.map(([idx, row]) => (
                      <tr key={idx} className="border-b border-slate-50">
                        <td className="px-2 py-2 font-medium text-slate-500 whitespace-nowrap">
                          {String(parseInt(idx, 10) + 1).padStart(2, '0')}
                        </td>
                        <td className="px-2 py-2 text-right font-medium text-slate-700 whitespace-nowrap">{row.spd || '—'}</td>
                        <td className="px-2 py-2 text-right font-medium text-slate-700 whitespace-nowrap">{row.out || '—'}</td>
                        <td className="px-2 py-2 text-slate-600 whitespace-pre-wrap max-w-[200px]">{row.log || '—'}</td>
                        <td className="px-2 py-2 text-right text-slate-700 whitespace-nowrap">{row.yld || '—'}</td>
                        <td className="px-2 py-2 text-right text-slate-700 whitespace-nowrap">{row.scr || '—'}</td>
                        <td className="px-2 py-2 text-center">
                          <Badge value={row.q} labels={QUALITY_LABELS} />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <Badge value={row.s} labels={SAFETY_LABELS} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Downtime Events */}
          {downtimeEvents.length > 0 && (
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={14} className="text-amber-600" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
                  Downtime Events ({downtimeEvents.length}, total {formatDuration(totalDowntimeMs)})
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                      <th className="px-2 py-2">Start</th>
                      <th className="px-2 py-2">Category</th>
                      <th className="px-2 py-2">Reason</th>
                      <th className="px-2 py-2 text-right">Duration</th>
                      <th className="px-2 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {downtimeEvents.slice(0, 20).map((evt) => (
                      <tr key={evt.id} className="border-b border-slate-50">
                        <td className="px-2 py-2 font-medium text-slate-600 whitespace-nowrap">
                          {formatEventTime(evt.start_epoch)}
                        </td>
                        <td className="px-2 py-2 text-slate-600">{evt.category ?? '—'}</td>
                        <td className="px-2 py-2 text-slate-700">{evt.reason ?? '—'}</td>
                        <td className="px-2 py-2 text-right font-bold text-slate-700 whitespace-nowrap">
                          {formatDuration(evt.duration_ms ?? 0)}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {evt.resolved ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
                              Resolved
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                              Ongoing
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {downtimeEvents.length > 20 && (
                  <p className="text-[11px] text-slate-400 m-0 mt-2">
                    Showing first 20 of {downtimeEvents.length} events
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Counter Readings */}
          {counterLogs.length > 0 && (
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={14} className="text-slate-600" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
                  Counter Readings ({counterLogs.length})
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {counterLogs.map((log, i) => (
                  <div
                    key={i}
                    className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-[12px]"
                  >
                    <span className="font-medium text-slate-500">{log.time}</span>
                    <span className="font-bold text-slate-700">{log.counter.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JobStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <p className="m-0 text-[13px] font-bold text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

function Badge({ value, labels }: { value: number; labels: string[] }) {
  const idx = Math.min(Math.max(value, 0), labels.length - 1);
  const label = labels[idx];
  const colors = ['bg-slate-100 text-slate-500', 'bg-green-100 text-green-700', 'bg-red-100 text-red-700'];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ${colors[idx]}`}>
      {label}
    </span>
  );
}
