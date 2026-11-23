import { useEffect, useRef, useState } from 'react';
import { readStored, STORED, writeStored } from '../shared/stored';
import { PanelHeader } from './components';
import { useKeepFocused } from './panels';

const MAX_LENGTH = 20_000;

/**
 * A scratchpad: one free text, saved as you type (half a second after the
 * last key) in the widgets' shared storage, so it survives restarts.
 */
export function NotesView({ active }: { active: boolean }) {
  const [text, setText] = useState(() => readStored(STORED.notes, ''));
  const area = useRef<HTMLTextAreaElement>(null);

  useKeepFocused(active, area);

  useEffect(() => {
    const id = setTimeout(() => writeStored(STORED.notes, text), 500);
    return () => clearTimeout(id);
  }, [text]);

  // Closing the panel saves at once, so a quick Esc never loses the last words.
  useEffect(() => {
    if (!active) writeStored(STORED.notes, text);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="view-panel notes">
      <PanelHeader title="Notes" back />
      <textarea
        ref={area}
        className="notes-area"
        value={text}
        placeholder="Jot something down…"
        spellCheck={false}
        maxLength={MAX_LENGTH}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="notes-foot muted-text">
        {text.length ? `${text.length.toLocaleString('en-GB')} characters · saved automatically` : 'Saved automatically'}
      </div>
    </div>
  );
}
