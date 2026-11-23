import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { openCount, readTodos, writeTodos, type Todo } from '../shared/todos';
import { PanelHeader } from './components';
import { useKeepFocused } from './panels';

/**
 * A short to-do list. Type and press Enter to add; click an item to tick it
 * off. Open items come first, newest on top; ticked ones follow until cleared.
 * The bar shows the number of open items (see `src/shared/todos.ts`).
 */
export function TodoView({ active }: { active: boolean }) {
  const [todos, setTodos] = useState(readTodos);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // Read again on opening, in case another window changed the list.
  useEffect(() => {
    if (active) setTodos(readTodos());
  }, [active]);

  useKeepFocused(active, input);

  const save = (next: Todo[]) => {
    setTodos(next);
    writeTodos(next);
  };

  const add = () => {
    const value = text.trim();
    if (!value) return;
    save([{ id: crypto.randomUUID(), text: value, done: false, created: Date.now() }, ...todos]);
    setText('');
  };
  const toggle = (id: string) => save(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => save(todos.filter((t) => t.id !== id));
  const clearDone = () => save(todos.filter((t) => !t.done));

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const left = openCount(todos);

  return (
    <div className="view-panel todo">
      <PanelHeader title="To-do" back />
      <label className="search">
        <Plus size={15} className="accent" />
        <input
          ref={input}
          value={text}
          placeholder="Add a task"
          spellCheck={false}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      </label>

      <div className="todo-list panel-scroll">
        {todos.length === 0 && <span className="muted-text">Nothing to do. Add a task above.</span>}
        {[...open, ...done].map((t) => (
          <div key={t.id} className={`todo-item ${t.done ? 'done' : ''}`} onClick={() => toggle(t.id)}>
            <span className="todo-check">{t.done && <Check size={12} strokeWidth={3} />}</span>
            <span className="todo-text">{t.text}</span>
            <button
              className="clip-delete"
              aria-label="Delete task"
              onClick={(e) => {
                e.stopPropagation();
                remove(t.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="todo-foot">
        <span className="muted-text">{left === 0 ? 'All done' : `${left} left`}</span>
        <button className="chip-button" onClick={clearDone} disabled={done.length === 0}>
          <Trash2 size={13} /> Clear done
        </button>
      </div>
    </div>
  );
}
