// Numeric input that keeps a local string while editing (empty allowed, no per-keystroke clamping).
// Validates on blur / Enter: in-range values are committed, out-of-range or empty are rejected and revert.
import { useEffect, useState } from "react";

export default function NumField({ value, min, max, onCommit, className, ...rest }: {
  value: number; min: number; max: number; onCommit: (v: number) => void; className?: string; "aria-label"?: string;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const [bad, setBad] = useState(false);
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const v = Number(text);
    if (text.trim() === "" || !Number.isFinite(v) || Math.round(v) < min || Math.round(v) > max) {
      setBad(text.trim() !== ""); setText(String(value)); return;
    }
    setBad(false); setText(String(Math.round(v)));
    if (Math.round(v) !== value) onCommit(Math.round(v));
  };
  return (
    <span className="block">
      <input {...rest} type="text" inputMode="numeric" className={className} value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => { setEditing(true); setBad(false); if (/^\d{0,3}$/.test(e.target.value)) setText(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(String(value)); setEditing(false); } }} />
      {bad && <span className="block text-[11px] text-rose-400">Must be {min}–{max}°F</span>}
    </span>
  );
}
