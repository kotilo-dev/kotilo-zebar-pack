import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useIsland, type PanelId } from './store';

/** A row of square dots, filled up to `value` (0..100). Click, drag or scroll to set it. */
export function DottedMeter({
  value,
  segments = 28,
  onChange,
  muted = false,
}: {
  value: number;
  segments?: number;
  onChange?: (value: number) => void;
  muted?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * segments);

  const valueAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * 100);
  };

  return (
    <div
      ref={ref}
      className={`meter ${onChange ? 'interactive' : ''} ${muted ? 'muted' : ''}`}
      onPointerDown={(e) => {
        if (!onChange) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onChange(valueAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (onChange && e.buttons === 1) onChange(valueAt(e.clientX));
      }}
      onWheel={(e) => onChange?.(Math.max(0, Math.min(100, Math.round(value + (e.deltaY < 0 ? 2 : -2)))))}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < filled ? 'on' : ''} />
      ))}
    </div>
  );
}

/** A dotted ring with a number and a caption in the middle. */
export function Ring({ value, label, unit = '', warnAt = 85 }: { value: number | null; label: string; unit?: string; warnAt?: number }) {
  const size = 58;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  // A 270° arc open at the bottom, as dots.
  const arc = circumference * 0.75;
  return (
    <div className={`ring ${value != null && v >= warnAt ? 'warn' : ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
          <circle
            className="track"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            strokeDasharray={`${arc} ${circumference}`}
          />
          <circle
            className="value"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            strokeDasharray={`${(arc * v) / 100} ${circumference}`}
          />
        </g>
      </svg>
      <div className="ring-text">
        <strong>{value == null ? '–' : `${Math.round(v)}${unit}`}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export const monthName = (m: number) => MONTHS[m];

/** ISO-8601 week number. */
export function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** A month grid, Monday first, always six weeks so its height never changes. `onPick` makes the days clickable. */
export function MonthCalendar({ today, onPick }: { today: Date; onPick?: (day: Date) => void }) {
  const [offset, setOffset] = useState(0);
  const shown = new Date(today.getFullYear(), today.getMonth() + offset, 1);

  const days = useMemo(() => {
    const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    return Array.from({ length: 42 }, (_, i) => new Date(shown.getFullYear(), shown.getMonth(), 1 - lead + i));
  }, [shown.getFullYear(), shown.getMonth()]);

  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button className="calendar-title" onClick={() => setOffset(0)} title="Back to today">
          {MONTHS[shown.getMonth()]} {shown.getFullYear()}
        </button>
        <div className="calendar-nav">
          <button onClick={() => setOffset(offset - 1)} aria-label="Previous month">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => setOffset(offset + 1)} aria-label="Next month">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="weekday">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const className = `day ${d.getMonth() !== shown.getMonth() ? 'other' : ''} ${same(d, today) ? 'is-today' : ''}`;
          return onPick ? (
            <button
              key={d.toISOString()}
              className={className}
              onClick={() => onPick(d)}
              title={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            >
              {d.getDate()}
            </button>
          ) : (
            <span key={d.toISOString()} className={className}>
              {d.getDate()}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A quick-settings tile: icon disc, title and a line of detail. With
 * `onIconClick` the disc is a button of its own (e.g. mute) and the rest of
 * the tile does `onClick` (e.g. open the sound panel); `more` adds a chevron
 * for tiles that open a panel.
 */
export function Tile({
  icon,
  title,
  detail,
  active = false,
  more = false,
  onClick,
  onIconClick,
  iconLabel,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  active?: boolean;
  more?: boolean;
  onClick?: () => void;
  onIconClick?: () => void;
  iconLabel?: string;
}) {
  const text = (
    <>
      <span className="tile-text">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {more && <ChevronRight size={14} className="tile-chevron" />}
    </>
  );
  if (onIconClick) {
    return (
      <div className={`tile split ${active ? 'active' : ''}`}>
        <button className="tile-icon" onClick={onIconClick} aria-label={iconLabel}>
          {icon}
        </button>
        <button className="tile-main" onClick={onClick} disabled={!onClick}>
          {text}
        </button>
      </div>
    );
  }
  return (
    <button className={`tile ${active ? 'active' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="tile-icon">{icon}</span>
      {text}
    </button>
  );
}

/**
 * A panel's title; panels reached from another panel get a way back to it.
 * `back` is that panel, or `true` for the control centre.
 */
export function PanelHeader({ title, back = false }: { title: ReactNode; back?: boolean | PanelId }) {
  const openPanel = useIsland((s) => s.openPanel);
  const target: PanelId = back === true || back === false ? 'control' : back;
  return (
    <header className="panel-header with-back">
      {back ? (
        <button className="header-back" onClick={() => openPanel(target)} aria-label="Back">
          <ChevronLeft size={15} />
        </button>
      ) : (
        <span className="header-back" />
      )}
      <div>{title}</div>
      <span className="header-back" />
    </header>
  );
}
