import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, ClipboardList, Activity, TimerOff, Settings } from 'lucide-react';
import { CalculatorView } from '@/components/CalculatorView';
import { DowntimeHistory } from '@/components/DowntimeHistory';
import { LiveLineStatus } from '@/components/LiveLineStatus';
import { MonitoringView } from '@/components/MonitoringView';
import { SettingsModal } from '@/components/SettingsModal';
import {
  computeHourlyOutputs,
  computeDowntimeLogs,
  createEmptyShiftData,
  createEmptyAppData,
  generateHours,
  getActiveHours,
  getDefaultRowCount,
  loadAppData,
  saveAppData,
  type AppData,
  type CalcInputs,
  type CustomConfig,
  type Shift,
  type ShiftDb,
  type ShiftRow,
  type ToggleState,
} from '@/types';
import { fetchCounterLogsByDate } from '@/lib/counterLogs';
import { fetchDowntimeByDate } from '@/lib/downtime';

type View = 'calculator' | 'tracker' | 'live' | 'downtime';
const VIEW_KEY = 'canning_calc_view';
const VALID_VIEWS: View[] = ['calculator', 'tracker', 'live', 'downtime'];

export default function App() {
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem(VIEW_KEY) as View | null;
    return saved && VALID_VIEWS.includes(saved) ? saved : 'live';
  });
  const [data, setData] = useState<AppData>(() => loadAppData());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    saveAppData(data);
  }, [data]);

  // Hide the bottom nav bar when the mobile soft keyboard opens so it
  // doesn't cover the input the user is typing into.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const threshold = 150;
    const update = () => setKeyboardOpen(window.innerHeight - vv.height > threshold);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const handleCalcChange = useCallback((field: keyof CalcInputs, value: string) => {
    setData((prev) => ({
      ...prev,
      calc: { ...prev.calc, [field]: value },
    }));
  }, []);

  const handleCalcUpdate = useCallback(() => {
    saveAppData(data);
  }, [data]);

  const handleCalcClear = useCallback(() => {
    if (!confirm('WARNING: You are about to clear all Filler Calculator inputs. Do you want to proceed?')) return;
    setData((prev) => ({
      ...prev,
      calc: {
        product: '', size: '', plan: '', speed: '', uvol: '', mvol: '',
        ratio: '', counter: '', bowl: '', layer: '', pallet: '',
      },
    }));
  }, []);

  const handleShiftChange = useCallback((shift: Shift) => {
    setData((prev) => ({ ...prev, shift }));
  }, []);

  const handleRowChange = useCallback(
    (shift: Shift, index: number, field: keyof ShiftRow, value: string) => {
      setData((prev) => {
        const next = structuredClone(prev) as AppData;
        const row = next.db[shift].rows[index] as unknown as Record<string, unknown>;
        row[field] = value;
        return next;
      });
    },
    []
  );

  const handleToggle = useCallback(
    (shift: Shift, index: number, field: 'q' | 's') => {
      setData((prev) => {
        const next = structuredClone(prev) as AppData;
        const row = next.db[shift].rows[index];
        const current = row[field] as ToggleState;
        row[field] = ((current + 1) % 3) as ToggleState;
        return next;
      });
    },
    []
  );

  const handleMetaChange = useCallback(
    (shift: Shift, field: 'date' | 'sku' | 'notes', value: string) => {
      setData((prev) => {
        const next = structuredClone(prev) as AppData;
        if (field === 'date') {
          next.date = value;
          next.db[shift].date = value;
        } else if (field === 'sku') {
          next.sku[shift] = value;
        } else {
          next.notes[shift] = value;
        }
        return next;
      });
    },
    []
  );

  const handleClearShift = useCallback((shift: Shift) => {
    setData((prev) => {
      const next = structuredClone(prev) as AppData;
      if (shift === 'Custom') {
        next.db[shift] = createEmptyShiftData(0);
        next.customHours = [];
      } else {
        next.db[shift] = createEmptyShiftData(getDefaultRowCount(shift));
      }
      next.notes[shift] = '';
      next.sku[shift] = '';
      next.db[shift].date = '';
      return next;
    });
  }, []);

  const handleCustomConfigChange = useCallback((config: CustomConfig) => {
    setData((prev) => ({ ...prev, customConfig: config }));
  }, []);

  const handleGenerateCustom = useCallback(() => {
    setData((prev) => {
      if (prev.customConfig.start === prev.customConfig.end) {
        alert('Start time and end time cannot be the same.');
        return prev;
      }
      const hours = generateHours(prev.customConfig.start, prev.customConfig.end, prev.customConfig.interval);
      const newCount = hours.length;
      const oldRows = prev.db['Custom'].rows;
      const rows: Record<number, ShiftRow> = {};
      for (let i = 0; i < newCount; i++) {
        rows[i] = oldRows[i] ? { ...oldRows[i] } : { spd: '', out: '', log: '', yld: '', scr: '', q: 0, s: 0 };
      }
      const next = structuredClone(prev) as AppData;
      next.customHours = hours;
      next.db['Custom'].rows = rows;
      return next;
    });
  }, []);

  const handleExportReport = useCallback(() => {
    const dateStr = data.date || '';
    const original = document.title;
    const reportName = `FF_${data.shift}${dateStr ? `_${dateStr}` : ''}`;
    document.title = reportName;

    const restore = () => {
      document.title = original;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);

    // On mobile the print sheet is async, so restoring right after window.print()
    // would wipe the title before the user picks "Save to PDF". afterprint fires
    // once the sheet closes. Fallback timeout in case the event never fires.
    window.setTimeout(restore, 60_000);

    window.print();
  }, [data.date, data.shift]);



function timeStrHour(time: string): number {
  return parseInt(time.split(':')[0] ?? '0', 10);
}

/**
 * Converts an end_epoch (Unix ms) to an OFS console-time string
 * ("YYYY-MM-DD HH:MM:SS") in the factory's timezone. The factory timezone
 * offset is derived from the event's own start_epoch/start_text pair, so no
 * hardcoded timezone is needed. Returns null if endEpoch is null (ongoing).
 */
function epochToConsoleTime(
  endEpoch: number | null,
  startEpoch: number,
  startText: string | null,
): string | null {
  if (endEpoch === null || !startText) return null;
  const offsetMs = startEpoch - Date.parse(startText.replace(' ', 'T'));
  const shifted = new Date(endEpoch - offsetMs);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  const h = String(shifted.getHours()).padStart(2, '0');
  const min = String(shifted.getMinutes()).padStart(2, '0');
  const s = String(shifted.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

  // Pull counter readings from the database for the selected date, compute
  // per-hour output, and fill the Actual Output column for the current shift.
  // For overnight shifts (start hour >= 12), also fetch the next day because
  // the shift spans midnight (e.g. a 20:00 shift on date D runs into D+1).
  const handleImportCounter = useCallback(async () => {
    const date = data.date;
    if (!date) {
      throw new Error('Select a date first at the top of the monitoring table.');
    }
    const shift = data.shift;
    const hours = getActiveHours(shift, data.customHours);
    const shiftStartStr = hours[0]?.split(' - ')[0]?.trim();
    const isOvernight = shiftStartStr ? timeStrHour(shiftStartStr) >= 12 : false;

    const logs = await fetchCounterLogsByDate(date);
    if (isOvernight) {
      const nextDate = new Date(`${date}T00:00:00`);
      nextDate.setDate(nextDate.getDate() + 1);
      const ny = nextDate.getFullYear();
      const nm = String(nextDate.getMonth() + 1).padStart(2, '0');
      const nd = String(nextDate.getDate()).padStart(2, '0');
      const nextLogs = await fetchCounterLogsByDate(`${ny}-${nm}-${nd}`);
      logs.push(...nextLogs);
    }
    if (logs.length === 0) {
      throw new Error(`No counter readings found in the database for ${date}.`);
    }
    setData((prev) => {
      const activeHours = getActiveHours(shift, prev.customHours);
      const outputs = computeHourlyOutputs(logs, activeHours, prev.date);
      const rowCount = Object.keys(prev.db[shift].rows).length;
      if (rowCount === 0) {
        throw new Error('No monitoring rows for this shift. Generate the table first.');
      }
      const next = structuredClone(prev) as AppData;
      for (let i = 0; i < rowCount; i++) {
        if (outputs[i] !== undefined) {
          next.db[shift].rows[i].out = outputs[i]!;
        }
      }
      return next;
    });
  }, [data.date, data.shift, data.customHours]);

  // Pull downtime events from the database for the selected date, map them onto
  // the shift's time intervals, and fill the Downtime Logs column.
  // For overnight shifts (start hour >= 12), also fetch the next day because
  // the shift spans midnight (e.g. a 20:00 shift on date D runs into D+1).
  const handleImportDowntime = useCallback(async () => {
    const date = data.date;
    if (!date) {
      throw new Error('Select a date first at the top of the monitoring table.');
    }
    const shift = data.shift;
    const hours = getActiveHours(shift, data.customHours);
    const shiftStartStr = hours[0]?.split(' - ')[0]?.trim();
    const isOvernight = shiftStartStr ? timeStrHour(shiftStartStr) >= 12 : false;

    const events = await fetchDowntimeByDate(date);
    if (isOvernight) {
      const nextDate = new Date(`${date}T00:00:00`);
      nextDate.setDate(nextDate.getDate() + 1);
      const ny = nextDate.getFullYear();
      const nm = String(nextDate.getMonth() + 1).padStart(2, '0');
      const nd = String(nextDate.getDate()).padStart(2, '0');
      const nextEvents = await fetchDowntimeByDate(`${ny}-${nm}-${nd}`);
      events.push(...nextEvents);
      events.sort((a, b) => b.start_epoch - a.start_epoch);
    }
    if (events.length === 0) {
      throw new Error(`No downtime events found in the database for ${date}.`);
    }
    setData((prev) => {
      const activeHours = getActiveHours(shift, prev.customHours);
      const rowCount = Object.keys(prev.db[shift].rows).length;
      if (rowCount === 0) {
        throw new Error('No monitoring rows for this shift. Generate the table first.');
      }
      const logs = computeDowntimeLogs(
        events.map((e) => ({ startText: e.start_text, endText: epochToConsoleTime(e.end_epoch, e.start_epoch, e.start_text), category: e.category, reason: e.reason, comments: e.comments })),
        activeHours,
        date
      );
      const next = structuredClone(prev) as AppData;
      for (let i = 0; i < rowCount; i++) {
        if (logs[i] !== undefined) {
          next.db[shift].rows[i].log = logs[i]!;
        }
      }
      return next;
    });
  }, [data.date, data.shift, data.customHours]);

  const calcMemo = useMemo(() => data.calc, [data.calc]);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#1e293b' }}>
      <div className="app-bar">
        <div className="app-bar-inner">
          <span className="app-bar-title">Free-Flow Manufacturing<br />Shift Manager Console<br />(Beta Testing)</span>
          <button
            type="button"
            className="app-bar-settings-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <Settings size={22} />
          </button>
        </div>
      </div>

      <div className="sm-container" style={{ paddingTop: 20, paddingBottom: 80 }}>
        {view === 'calculator' ? (
          <CalculatorView
            calc={calcMemo}
            onChange={handleCalcChange}
            onUpdate={handleCalcUpdate}
            onClear={handleCalcClear}
          />
        ) : view === 'live' ? (
          <LiveLineStatus
            currentShift={data.shift}
            customHours={data.customHours}
            date={data.date}
            onDateChange={(value) => handleMetaChange(data.shift, 'date', value)}
          />
        ) : view === 'downtime' ? (
          <DowntimeHistory
            date={data.date}
            onDateChange={(value) => handleMetaChange(data.shift, 'date', value)}
            currentShift={data.shift}
            customHours={data.customHours}
          />
        ) : (
          <MonitoringView
            db={data.db}
            notes={data.notes}
            sku={data.sku}
            currentShift={data.shift}
            customConfig={data.customConfig}
            customHours={data.customHours}
            date={data.date}
            onShiftChange={handleShiftChange}
            onRowChange={handleRowChange}
            onToggle={handleToggle}
            onMetaChange={handleMetaChange}
            onClearShift={handleClearShift}
            onCustomConfigChange={handleCustomConfigChange}
            onGenerateCustom={handleGenerateCustom}
            onExportReport={handleExportReport}
            onImportCounter={handleImportCounter}
            onImportDowntime={handleImportDowntime}
          />
        )}

        <div className="footer">
          Shift Manager Console v2.00 - Created by <strong>Kelvin George</strong>
        </div>
      </div>

      <nav className={`bottom-tab-bar${keyboardOpen ? ' bottom-tab-bar-hidden' : ''}`} aria-label="Section navigation" aria-hidden={keyboardOpen}>
        <span className="bottom-tab-indicator" style={{ ['--i' as string]: String(((['live','tracker','downtime','calculator'] as const).indexOf(view))) }} aria-hidden="true" />
        {([
          { id: 'live', label: 'Live', Icon: Activity },
          { id: 'tracker', label: 'Monitoring', Icon: ClipboardList },
          { id: 'downtime', label: 'Downtime', Icon: TimerOff },
          { id: 'calculator', label: 'Calculator', Icon: Calculator },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`bottom-tab-btn ${view === id ? 'active' : ''}`}
            onClick={() => setView(id)}
            aria-current={view === id ? 'page' : undefined}
          >
            <Icon size={22} aria-hidden="true" />
            <span className="bottom-tab-label">{label}</span>
          </button>
        ))}
      </nav>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
