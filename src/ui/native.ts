// Desktop (Tauri) bridge. UniSim runs only as a desktop app; there is no browser build.
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
const tauri = (window as any).__TAURI__ as { core?: { invoke: Invoke } } | undefined;

export const isApp = !!tauri?.core?.invoke;

const invoke: Invoke = (cmd, args) => {
  if (!isApp) return Promise.reject(new Error('UniSim must be run as the desktop app'));
  return tauri!.core!.invoke(cmd, args);
};

/** native "Save as" dialog; resolves to the written path, or null if cancelled */
export function saveText(name: string, text: string, _type?: string): Promise<string | null> {
  return invoke<string | null>('save_text', { name, contents: text });
}

/** native "Open" dialog for a text file */
export async function openText(ext: string): Promise<{ name: string; text: string } | null> {
  const r = await invoke<[string, string] | null>('open_text', { ext });
  return r ? { name: r[0], text: r[1] } : null;
}
