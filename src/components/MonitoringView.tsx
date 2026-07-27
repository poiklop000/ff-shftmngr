import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  filterByShiftWindow,
  generateHours,
  getActiveHours,
  parseNumber,
  SHIFT_LABELS,
  SHIFT_LIST,
  type CustomConfig,
  type Shift,
  type ShiftDb,
  type ShiftRow,
} from '@/types';
import { ShiftTable } from '@/components/ShiftTable';
import { DowntimeTimeline } from '@/components/DowntimeTimeline';
import { fetchDowntimeByDate, type DowntimeEvent } from '@/lib/downtime';
import { fetchOfsStatus, type OfsLiveStatus } from '@/lib/ofs';
import { useAutoGrow } from '@/lib/ui';

interface MonitoringViewProps {
  db: ShiftDb;
  notes: Record<Shift, string>;
  sku: Record<Shift, string>;
  currentShift: Shift;
  customConfig: CustomConfig;
  customHours: string[];
  date: string;
  onShiftChange: (shift: Shift) => void;
  onRowChange: (shift: Shift, index: number, field: keyof ShiftRow, value: string) => void;
  onToggle: (shift: Shift, index: number, field: 'q' | 's') => void;
  onMetaChange: (shift: Shift, field: 'date' | 'sku' | 'notes', value: string) => void;
  onClearShift: (shift: Shift) => void;
  onCustomConfigChange: (config: CustomConfig) => void;
  onGenerateCustom: () => void;
  onExportReport: () => void;
  onImportCounter: () => Promise<void>;
  onImportDowntime: () => Promise<void>;
}

export function MonitoringView({
  db,
  notes,
  sku,
  currentShift,
  customConfig,
  customHours,
  date,
  onShiftChange,
  onRowChange,
  onToggle,
  onMetaChange,
  onClearShift,
  onCustomConfigChange,
  onGenerateCustom,
  onExportReport,
  onImportCounter,
  onImportDowntime,
}: MonitoringViewProps) {
  const [importingCounter, setImportingCounter] = useState(false);
  const [importingDowntime, setImportingDowntime] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<DowntimeEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [consoleTime, setConsoleTime] = useState('-');

  const activeHours = getActiveHours(currentShift, customHours);

  const loadTimeline = useCallback(async (shift: Shift, customHrs: string[], shiftDate: string) => {
    if (!shiftDate) { setTimelineEvents([]); return; }
    setTimelineLoading(true);
    try {
      const hours = getActiveHours(shift, customHrs);
      const startStr = hours[0]?.split(' - ')[0]?.trim();
      const isOvernight = startStr ? parseInt(startStr.split(':')[0] ?? '0', 10) >= 12 : false;
      const events = await fetchDowntimeByDate(shiftDate);
      if (isOvernight) {
        const d = new Date(`${shiftDate}T00:00:00`);
        d.setDate(d.getDate() + 1);
        const ny = d.getFullYear();
        const nm = String(d.getMonth() + 1).padStart(2, '0');
        const nd = String(d.getDate()).padStart(2, '0');
        const next = await fetchDowntimeByDate(`${ny}-${nm}-${nd}`);
        events.push(...next);
        events.sort((a, b) => b.start_epoch - a.start_epoch);
      }
      setTimelineEvents(events);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTimeline(currentShift, customHours, date);
  }, [loadTimeline, currentShift, customHours, date]);

  useEffect(() => {
    let cancelled = false;
    const loadConsoleTime = async () => {
      try {
        const data: OfsLiveStatus = await fetchOfsStatus();
        if (cancelled) return;
        const t = data.workcentre?.consoletimeText || data.timestampText || '-';
        setConsoleTime(t);
      } catch {
        // leave existing console time if the fetch fails
      }
    };
    loadConsoleTime();
    const id = setInterval(loadConsoleTime, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const shiftTimelineEvents = useMemo(
    () => filterByShiftWindow(timelineEvents, currentShift, activeHours, date, (e) => e.start_text),
    [timelineEvents, currentShift, activeHours, date],
  );

  const handleImportCounter = async () => {
    setImportingCounter(true);
    setImportMsg(null);
    try {
      await onImportCounter();
      setImportMsg('Counter data imported');
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportingCounter(false);
    }
  };

  const handleImportDowntime = async () => {
    setImportingDowntime(true);
    setImportMsg(null);
    try {
      await onImportDowntime();
      setImportMsg('Downtime logs imported');
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportingDowntime(false);
    }
  };

  const showCustomPanel = currentShift === 'Custom';

  const currentData = db[currentShift];
  const rowCount = Object.keys(currentData.rows).length;

  const { totalOutput, avgOee } = useMemo(() => {
    let total = 0;
    let oeeSum = 0;
    let count = 0;
    for (let i = 0; i < rowCount; i++) {
      const r = currentData.rows[i];
      if (!r) continue;
      total += parseNumber(r.out);
      const rowOut = parseNumber(r.out);
      const rowSpd = parseNumber(r.spd);
      if (rowOut > 0 && rowSpd > 0) {
        oeeSum += (rowOut / rowSpd) * 100;
        count++;
      }
    }
    return {
      totalOutput: total.toLocaleString(),
      avgOee: count > 0 ? (oeeSum / count).toFixed(2) : '0.00',
    };
  }, [currentData, rowCount]);

  const skuRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(skuRef, sku[currentShift], 28);
  useAutoGrow(notesRef, notes[currentShift], 80);

  return (
    <div>
      <div className="card card-blue">
        <h3 style={{ margin: 0, border: 'none', padding: 0, borderBottom: '1px solid currentColor', paddingBottom: 6 }}>
          Free-Flow Performance Board
        </h3>

        <div className="card-row" style={{ marginTop: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            SKU:
          </label>
          <input
            type="date"
            className="card-date-input"
            value={date}
            onChange={(e) => onMetaChange(currentShift, 'date', e.target.value)}
          />
        </div>

        <textarea
          ref={skuRef}
          className="sku-textarea no-print"
          rows={1}
          placeholder="Enter SKUs..."
          maxLength={600}
          value={sku[currentShift]}
          onChange={(e) => {
            const lines = e.target.value.split('\n');
            const trimmed = lines.map((line) => line.substring(0, 60));
            onMetaChange(currentShift, 'sku', trimmed.join('\n'));
          }}
        />
        <div className="print-text-block print-only">{sku[currentShift]}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 15, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="form-control"
          style={{ maxWidth: 220, margin: 0 }}
          value={currentShift}
          onChange={(e) => onShiftChange(e.target.value as Shift)}
        >
          {SHIFT_LIST.map((s) => (
            <option key={s} value={s}>{SHIFT_LABELS[s]}</option>
          ))}
        </select>
        <button
          type="button"
          className="tab-btn tab-btn-red"
          onClick={() => {
            if (confirm('WARNING: You are about to completely delete all data entered for this shift. Do you want to proceed?')) {
              onClearShift(currentShift);
            }
          }}
        >
          Clear Shift Data
        </button>
      </div>

      {showCustomPanel && (
        <div className="custom-interval-panel">
          <label>Start:</label>
          <input
            type="time"
            value={customConfig.start}
            onChange={(e) => onCustomConfigChange({ ...customConfig, start: e.target.value })}
          />
          <label>End:</label>
          <input
            type="time"
            value={customConfig.end}
            onChange={(e) => onCustomConfigChange({ ...customConfig, end: e.target.value })}
          />
          <label>Interval:</label>
          <select
            value={customConfig.interval}
            onChange={(e) => onCustomConfigChange({ ...customConfig, interval: parseInt(e.target.value, 10) })}
          >
            <option value={60}>1 Hour</option>
            <option value={30}>30 Minutes</option>
            <option value={15}>15 Minutes</option>
            <option value={120}>2 Hours</option>
          </select>
          <button type="button" className="tab-btn tab-btn-blue" onClick={onGenerateCustom}>
            Generate Table
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 15, marginBottom: 15, justifyContent: 'center', flexWrap: 'wrap' }}>
        <div className="card card-green">
          <div className="card-row">
            <span>Shift Total Output:</span>
            <span style={{ fontWeight: 'bold', fontSize: 14, color: '#166534' }}>{totalOutput}</span>
          </div>
        </div>
        <div className="card card-teal">
          <div className="card-row">
            <span>Shift Average OEE:</span>
            <span style={{ fontWeight: 'bold', fontSize: 14, color: '#115e59' }}>{avgOee}%</span>
          </div>
        </div>
      </div>

      <DowntimeTimeline
        events={shiftTimelineEvents}
        currentShift={currentShift}
        customHours={customHours}
        date={date}
        consoleTime={consoleTime}
        loading={timelineLoading}
      />

      <ShiftTable
        hours={activeHours}
        rows={currentData.rows}
        rowCount={rowCount}
        onRowChange={(index, field, value) => onRowChange(currentShift, index, field, value)}
        onToggle={(index, field) => onToggle(currentShift, index, field)}
      />

      <div className="card card-blue">
        <h3>Notes</h3>
        <textarea
          ref={notesRef}
          className="table-text-area no-print"
          rows={1}
          style={{ width: '100%', maxWidth: '100%', minHeight: 80, fontSize: 13, fontWeight: 500, color: '#0f172a', textAlign: 'left' }}
          placeholder="Enter production run details, observations, or handover notes... (Enter for new line)"
          value={notes[currentShift]}
          onChange={(e) => onMetaChange(currentShift, 'notes', e.target.value)}
        />
        <div className="print-text-block print-only">{notes[currentShift]}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="tab-btn tab-btn-green"
          onClick={handleImportCounter}
          disabled={importingCounter || importingDowntime}
          title="Pull hourly production counts from OFS for the selected date and fill the Actual Output column"
        >
          {importingCounter ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Import Counter
        </button>
        <button
          type="button"
          className="tab-btn tab-btn-amber"
          onClick={handleImportDowntime}
          disabled={importingCounter || importingDowntime}
          title="Pull downtime events from the database for the selected date and fill the Downtime Logs column"
        >
          {importingDowntime ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Import Downtime
        </button>
        <button type="button" className="tab-btn tab-btn-blue" onClick={onExportReport}>
          Print / Export Report
        </button>
      </div>
      {importMsg && (
        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12, fontWeight: 600, color: importMsg.includes('failed') ? '#b91c1c' : '#166534' }}>
          {importMsg}
        </div>
      )}
    </div>
  );
}
