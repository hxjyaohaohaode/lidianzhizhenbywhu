/** Compare visible form inputs without serializing File values to empty objects.
 * File identity also distinguishes reselections with equal names, sizes and dates.
 * No file bytes are read or retained by the guard.
 */
const fileSelections = new WeakMap();
let nextSelection = 0;
export function formSnapshot(form) {
    return JSON.stringify([...new FormData(form)].map(([name, value]) => {
        if (typeof value === 'string')
            return [name, value];
        // Browsers create a fresh empty File for an unselected upload on each read.
        if (!value.name && value.size === 0)
            return [name, { unselected: true }];
        let selection = fileSelections.get(value);
        if (selection === undefined) {
            selection = ++nextSelection;
            fileSelections.set(value, selection);
        }
        return [name, { selection, name: value.name, size: value.size, type: value.type, lastModified: value.lastModified }];
    }));
}
