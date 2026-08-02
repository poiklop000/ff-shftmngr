import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Save, FolderOpen, CheckCircle2, Package } from 'lucide-react';
import {
  filterByShiftWindow,
  generateHours,
  getActiveHours,
  parseNumber,
  SHIFT_LABELS,
  type CustomConfig,
  type Shift,
  type ShiftDb,
  type ShiftRow,
} from '@/types';
import { ShiftTable } from '@/components/ShiftTable';
import { DowntimeTimeline } from '@/components/DowntimeTimeline';
import { PageHelp } from '@/components/PageHelp';
import { fetchDowntimeByDate, type DowntimeEvent } from '@/lib/downtime';
import { fetchOfsStatus, type OfsLiveStatus } from '@/lib/ofs';
import { fetchJobsForShift } from '@/lib/jobSnapshots';
import { useAutoGrow } from '@/lib/ui';

interface MonitoringViewProps {
  db: ShiftDb;
  notes: Record<Shift, string>;
  sku: Record<Shift, string>;
  currentShift: Shift;
  customConfig: CustomConfig;
  customHours: string[];
  date: string;
  onRowChange: (shift: Shift, index: number, field: keyof ShiftRow, value: string) => void;
  onToggle: (shift: Shift, index: number, field: 'q' | 's') => void;
  onMetaChange: (shift: Shift, field: 'date' | 'sku' | 'notes', value: string) => void;
  onClearShift: (shift: Shift) => void;
  onCustomConfigChange: (config: CustomConfig) => void;
  onGenerateCustom: () => void;
  onExportReport: () => void;
  onImportCounter: () => Promise<void>;
  onImportDowntime: () => Promise<void>;
  onSaveRecord: () => Promise<void>;
  onLoadRecord: () => Promise<void>;
  hasSavedRecord: boolean;
}

export function MonitoringView({
  db,
  notes,
  sku,
  currentShift,
  customConfig,
  customHours,
  date,
  onRowChange,
  onToggle,
  onMetaChange,
  onClearShift,
  onCustomConfigChange,
  onGenerateCustom,
  onExportReport,
  onImportCounter,
  onImportDowntime,
  onSaveRecord,
  onLoadRecord,
  hasSavedRecord,
}: MonitoringViewProps) {
  const [importingCounter, setImportingCounter] = useState(false);
  const [importingDowntime, setImportingDowntime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<DowntimeEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [consoleTime, setConsoleTime] = useState('-');
  const [activeJobs, setActiveJobs] = useState<string[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [userEditedSku, setUserEditedSku] = useState(false);

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

  // Auto-populate SKU from job snapshots in the database
  useEffect(() => {
    if (!date || userEditedSku) return;
    let cancelled = false;
    setJobsLoading(true);
    setJobsError(null);
    fetchJobsForShift(date, currentShift, customHours)
      .then((jobs) => {
        if (cancelled) return;
        setActiveJobs(jobs);
        if (jobs.length > 0) {
          onMetaChange(currentShift, 'sku', jobs.join('\n'));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setJobsError(err instanceof Error ? err.message : 'Failed to load jobs');
      })
      .finally(() => { if (!cancelled) setJobsLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, currentShift, customHours, userEditedSku]);

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

  const handleSave = async () => {
    setSaving(true);
    setImportMsg(null);
    try {
      await onSaveRecord();
      setImportMsg('Record saved to database');
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadRecord = async () => {
    setLoadingRecord(true);
    setImportMsg(null);
    try {
      await onLoadRecord();
      setImportMsg('Record loaded from database');
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoadingRecord(false);
    }
  };

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

  const displaySku = sku[currentShift] || activeJobs.join('\n');

  return (
    <div>
      <PageHelp
        title="Monitoring"
        intro="This is your shift handover board. Track rated speed, actual output, OEE, quality, safety, downtime, yield, and scrap for each time interval of the selected shift."
        sections={[
          {
            title: "Setting up the shift",
            items: [
              "Pick a shift from the dropdown (Morning, Night, 1st, 2nd, 3rd, or Custom).",
              "Set the date at the top of the page.",
              "If you choose Custom, define your own start time, end time, and interval (15 min, 30 min, 1 hour, or 2 hours), then click Generate Table to create the rows.",
            ],
          },
          {
            title: "Filling in the table",
            items: [
              "Each row is one time interval. Type in Rated Speed and Actual Output for each hour.",
              "OEE % is auto-calculated from your output vs rated speed. Green if 70% or above, red if below.",
              "Quality and Safety columns have toggle buttons. Tap to cycle through Not Set, Pass, and Issue Logged.",
              "Downtime Logs - type any shift delays or notes for that interval. Press Enter for a new line, Tab to move to the next field.",
              "Filler Yield - enter the yield percentage. It turns red below 97% and green at or above.",
              "Scrap - enter the scrap percentage for that interval.",
            ],
          },
          {
            title: "Importing data automatically",
            items: [
              "Import Counter - pulls hourly production counts from OFS into the Actual Output column for the selected date and shift.",
              "Import Downtime - pulls downtime events from OFS into the Downtime Logs column, mapped to the correct time intervals.",
              "Both imports require a date to be selected first.",
            ],
          },
          {
            title: "Notes, SKU, and exporting",
            items: [
              "Type any shift notes and the SKU at the top of the board.",
              "Print / Export Report - saves or prints the full shift report as a PDF. The help guide and edit fields are excluded from the printout.",
              "Clear Shift Data - wipes everything for the current shift. You'll be asked to confirm first.",
            ],
          },
          {
            title: "Saving and loading records",
            items: [
              "Save Record - stores everything on the board (rows, notes, SKU) plus the current active job, downtime events, and counter readings to the database for future reference.",
              "Load Record - retrieves a previously saved record for the selected date and shift, restoring the board to exactly how it was saved.",
              "Saving again for the same date and shift replaces the previous record.",
            ],
          },
          {
            title: "Timeline bar",
            items: [
              "The bar above the table shows downtime events across the shift in colour: red for unplanned, blue for planned, yellow for setup.",
              "A dark vertical line shows the current time within the shift (the 'now' marker).",
              "The green portion shows how far through the shift you are.",
            ],
          },
        ]}
      />

      <div className="card card-blue">
        <h3 style={{ margin: 0, border: 'none', padding: 0, borderBottom: '1px solid currentColor', paddingBottom: 6 }}>
          Free-Flow Performance Board — {SHIFT_LABELS[currentShift]} · {date || 'No date selected'}
        </h3>

        <div className="card-row" style={{ marginTop: 12, alignItems: 'flex-start' }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Package size={13} />
            SKUs:
          </label>
          {jobsLoading ? (
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Loader2 size={12} className="animate-spin" /> Loading active jobs from database…
            </span>
          ) : jobsError ? (
            <span style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>{jobsError}</span>
          ) : activeJobs.length > 0 ? (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 4 }}>
                Auto-populated from job snapshots
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a', lineHeight: 1.6 }}>
                {activeJobs.map((j, i) => (
                  <div key={i}>{j}</div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontWeight: 500 }}>
                You can edit below if needed — editing overrides auto-population.
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              No active jobs captured for this shift yet.
            </span>
          )}
        </div>

        <textarea
          ref={skuRef}
          className="sku-textarea no-print"
          rows={1}
          placeholder="SKUs auto-populate from active jobs. Edit here to override…"
          maxLength={600}
          value={displaySku}
          onChange={(e) => {
            setUserEditedSku(true);
            const lines = e.target.value.split('\n');
            const trimmed = lines.map((line) => line.substring(0, 60));
            onMetaChange(currentShift, 'sku', trimmed.join('\n'));
          }}
        />
        <div className="print-text-block print-only">{displaySku}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 15, alignItems: 'center', flexWrap: 'wrap' }}>
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
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="tab-btn tab-btn-green"
          onClick={handleSave}
          disabled={saving || loadingRecord || importingCounter || importingDowntime}
          title="Save the current board data, active job, downtime, and counter readings to the database"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Record
        </button>
        <button
          type="button"
          className="tab-btn tab-btn-amber"
          onClick={handleLoadRecord}
          disabled={saving || loadingRecord || importingCounter || importingDowntime || !hasSavedRecord}
          title={hasSavedRecord ? 'Load a previously saved record for this date and shift' : 'No saved record for this date and shift'}
        >
          {loadingRecord ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
          Load Record
        </button>
        {hasSavedRecord && !saving && !loadingRecord && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#166534' }}>
            <CheckCircle2 size={12} /> Saved record exists
          </span>
        )}
      </div>
      {importMsg && (
        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12, fontWeight: 600, color: importMsg.includes('failed') ? '#b91c1c' : '#166534' }}>
          {importMsg}
        </div>
      )}
    </div>
  );
}
