/** Invalidate asynchronous UI continuations after newer navigation or dismissal.
 * This does not cancel or retry a server mutation: its outcome remains in history.
 */
let generation=0;
export function invalidateInteractions(){generation++;}
export function interactionGuard(){const started=generation;return ()=>started===generation;}

// An editable dialog keeps its owner while the user types. Only an already
// started continuation loses permission to repaint those newer inputs.
let inputGeneration=0;
export function invalidateInputs(){inputGeneration++;}
export function continuationGuard(){const current=interactionGuard(),started=inputGeneration;return ()=>current()&&started===inputGeneration;}

/** A confirmed server write must not steal a newer page or dismiss a newer draft.
 * The refresh callback stages reads and publishes only while this guard holds.
 */
export async function finishMutation(valid:()=>boolean,refresh:(valid:()=>boolean)=>Promise<boolean>,apply:()=>void|Promise<void>):Promise<boolean>{
 if(!valid())return false;
 if(!await refresh(valid)||!valid())return false;
 await apply();return true;
}

/** Only call after a known successful create. Unknown outcomes retain the retry key. */
export function renewSavedDraft(submitted:string,read:()=>string|null,renew:()=>void):boolean{
 const latest=read();if(latest===null||latest===submitted)return false;
 renew();return true;
}
