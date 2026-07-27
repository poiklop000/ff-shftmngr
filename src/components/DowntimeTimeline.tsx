import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { consoleTimeToShiftMinutes, getActiveHours, type Shift } from '@/types';
import type { DowntimeEvent } from '@/lib/downtime';

const TYPE_COLORS: Record<string, string> = {
  UNPLANNED: '#ef4444',
  PLANNED: '#3b82f6',
  SETUP: '#f59e0b',
};

const RUNNING_COLOR = '#22c55e';

function getTypeColor(type: string | null): string {
  if (!type) return '#94a3b8';
  return TYPE_COLORS[type.toUpperCase()] ?? '#94a3b8';
}

function timeStrToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatHour(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function formatDurationShort(minutes: number): string {
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function computeNowPct(
  consoleTime: string,
  shiftDate: string,
  shiftStartMin: number,
  shiftEndMin: number,
  totalMin: number,
): number | null {
  if (!consoleTime || consoleTime === '-') return null;
  const dateMatch = consoleTime.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch && dateMatch[1] !== shiftDate) return null;
  const timeMatch = consoleTime.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) return null;
  const h = parseInt(timeMatch[1], 10);
  const m = parseInt(timeMatch[2], 10);
  const minOfDay = h * 60 + m;
  let shiftMin = minOfDay;
  if (shiftEndMin > 1440 && minOfDay < shiftStartMin) shiftMin = minOfDay + 1440;
  if (shiftMin < shiftStartMin || shiftMin > shiftEndMin) return null;
  return ((shiftMin - shiftStartMin) / totalMin) * 100;
}

interface TimelineBlock {
  leftPct: number;
  widthPct: number;
  color: string;
  label: string;
  durationLabel: string;
}

interface HourMark {
  pct: number;
  label: string;
}

interface DowntimeTimelineProps {
  events: DowntimeEvent[];
  currentShift: Shift;
  customHours: string[];
  date: string;
  consoleTime: string;
  loading?: boolean;
}

export function DowntimeTimeline({
  events,
  currentShift,
  customHours,
  date,
  consoleTime,
  loading,
}: DowntimeTimelineProps) {
  const { blocks, hourMarks, nowPct, runWidthPct, totalDowntimeMin, eventCount } = useMemo(() => {
    const hours = getActiveHours(currentShift, customHours);
    if (hours.length === 0 || !date) {
      return {
        blocks: [] as TimelineBlock[],
        hourMarks: [] as HourMark[],
        nowPct: null,
        runWidthPct: 100,
        totalDowntimeMin: 0,
        eventCount: 0,
      };
    }

    const startStr = hours[0]!.split(' - ')[0]!.trim();
    const endStr = hours[hours.length - 1]!.split(' - ')[1]!.trim();
    const shiftStartMin = timeStrToMinutes(startStr);
    const endMinRaw = timeStrToMinutes(endStr);
    const shiftEndMin = endMinRaw <= shiftStartMin ? endMinRaw + 1440 : endMinRaw;
    const totalMin = shiftEndMin - shiftStartMin;

    const nowPct = computeNowPct(consoleTime, date, shiftStartMin, shiftEndMin, totalMin);
    const nowShiftMin = nowPct !== null ? shiftStartMin + (nowPct / 100) * totalMin : null;

    const blocks: TimelineBlock[] = [];
    let totalDowntimeMin = 0;

    for (const evt of events) {
      if (!evt.start_text) continue;
      const startMin = consoleTimeToShiftMinutes(evt.start_text, date);
      const endMin = evt.resolved
        ? startMin + (evt.duration_ms ?? 0) / 60000
        : nowShiftMin ?? shiftEndMin;

      if (endMin <= shiftStartMin || startMin >= shiftEndMin) continue;

      const clampedStart = Math.max(startMin, shiftStartMin);
      const clampedEnd = Math.min(endMin, shiftEndMin);
      const durMin = clampedEnd - clampedStart;
      if (durMin <= 0) continue;

      const leftPct = ((clampedStart - shiftStartMin) / totalMin) * 100;
      const widthPct = (durMin / totalMin) * 100;

      blocks.push({
        leftPct,
        widthPct: Math.max(widthPct, 0.25),
        color: getTypeColor(evt.downtime_type),
        label: evt.reason ?? evt.category ?? 'Downtime',
        durationLabel: formatDurationShort(durMin),
      });
      totalDowntimeMin += durMin;
    }

    const hourMarks: HourMark[] = [];
    const labelInterval = totalMin > 600 ? 2 : 1;
    for (let m = shiftStartMin, i = 0; m <= shiftEndMin; m += 60, i++) {
      if (i % labelInterval === 0) {
        hourMarks.push({ pct: ((m - shiftStartMin) / totalMin) * 100, label: formatHour(m) });
      }
    }

    return {
      blocks,
      hourMarks,
      nowPct,
      runWidthPct: nowPct !== null ? nowPct : 100,
      totalDowntimeMin,
      eventCount: blocks.length,
    };
  }, [events, currentShift, customHours, date, consoleTime]);

  return (
    <div className="mb-4 px-1">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          Shift Timeline
        </span>
        {eventCount > 0 && (
          <span className="text-[11px] font-medium text-slate-400">
            <span className="font-bold text-red-500">{formatDurationShort(totalDowntimeMin)}</span>
            {' '}downtime · {eventCount} {eventCount === 1 ? 'event' : 'events'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-5 text-slate-300">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : (
        <>
          {/* Track */}
          <div className="relative h-5 rounded-full overflow-hidden bg-slate-100 shadow-inner">
            {/* Running / elapsed fill */}
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${runWidthPct}%`, backgroundColor: RUNNING_COLOR, opacity: 0.85 }}
            />

            {/* Downtime blocks */}
            {blocks.map((b, i) => (
              <div
                key={i}
                className="absolute inset-y-0.5 rounded-full cursor-default transition-opacity hover:opacity-100"
                style={{
                  left: `${b.leftPct}%`,
                  width: `${b.widthPct}%`,
                  backgroundColor: b.color,
                  minWidth: '3px',
                  opacity: 0.92,
                }}
                title={`${b.label} · ${b.durationLabel}`}
              />
            ))}

            {/* Now needle */}
            {nowPct !== null && (
              <div
                className="absolute inset-y-0 w-px bg-white/70 z-10 pointer-events-none"
                style={{ left: `${nowPct}%` }}
              />
            )}
          </div>

          {/* Hour labels below */}
          <div className="relative h-4 mt-1">
            {hourMarks.map((m, i) => (
              <span
                key={i}
                className="absolute text-[9px] font-medium text-slate-400 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${m.pct}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>

          {eventCount === 0 && (
            <p className="text-[11px] text-slate-400 font-medium mt-0.5 m-0">
              No downtime this shift.
            </p>
          )}
        </>
      )}
    </div>
  );
}
