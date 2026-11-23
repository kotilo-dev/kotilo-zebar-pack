import { readStored, STORED, writeStored } from './stored';

/**
 * To-do items. The island edits them; the bar shows how many are open. Both
 * read the widgets' shared `localStorage` (see `stored.ts`), so the list
 * survives restarts without any helper.
 */
export type Todo = { id: string; text: string; done: boolean; created: number };

export function readTodos(): Todo[] {
  const list = readStored<unknown>(STORED.todos, []);
  return Array.isArray(list) ? (list as Todo[]) : [];
}

export const writeTodos = (todos: Todo[]) => writeStored(STORED.todos, todos);

export const openCount = (todos: Todo[]) => todos.filter((t) => !t.done).length;
