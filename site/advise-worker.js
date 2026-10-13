// The advisor off the main thread: { id, form } in -> { id, rows } or
// { id, error } out (ui-logic.js buildPosition + advise; ~0.5-2 s a position).
import { buildPosition, advise } from "./ui-logic.js";

onmessage = (e) => {
  const { id, form } = e.data;
  try {
    postMessage({ id, rows: advise(buildPosition(form)) });
  } catch (err) {
    postMessage({ id, error: err.message });
  }
};
