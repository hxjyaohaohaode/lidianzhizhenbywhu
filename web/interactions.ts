/** Invalidate asynchronous UI continuations after newer navigation or dismissal.
 * This does not cancel or retry a server mutation: its outcome remains in history.
 */
let generation=0;
export function invalidateInteractions(){generation++;}
export function interactionGuard(){const started=generation;return ()=>started===generation;}
