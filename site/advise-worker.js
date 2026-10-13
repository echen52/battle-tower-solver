// The advisor off the main thread: { id, form, turns, only } in -> { id, rows }
// or { id, error } out (ui-logic.js buildPosition + advise; one turn ~0.5-2 s
// a position, two turns seconds per option).
import { buildPosition, advise } from "./ui-logic.js";

onmessage = (e) => {
  const { id, form, turns = 1, only = null, part = null } = e.data;
  try {
    postMessage({ id, rows: advise(buildPosition(form), { turns, only, part }) });
  } catch (err) {
    postMessage({ id, error: err.message });
  }
};
