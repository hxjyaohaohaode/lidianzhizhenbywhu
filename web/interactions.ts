/** Invalidate asynchronous UI continuations after newer navigation or dismissal.
 * This does not cancel or retry a server mutation: its outcome remains in history.
 */
let generation=0;
export function invalidateInteractions(){generation++;}
export function interactionGuard(){const started=generation;return ()=>started===generation;}

/** A confirmed server write must not steal a newer page or dismiss a newer draft.
 * The refresh callback stages reads and publishes only while this guard holds.
 */
export async function finishMutation(valid:()=>boolean,refresh:(valid:()=>boolean)=>Promise<boolean>,apply:()=>void):Promise<boolean>{
 if(!valid())return false;
 if(!await refresh(valid)||!valid())return false;
 apply();return true;
}
