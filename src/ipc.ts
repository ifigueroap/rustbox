import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** Single point of contact with the native backend. Tests mock this module
 * instead of the Tauri API package, so the shell's own save and render code
 * runs unchanged against a fake backend. */
export const invoke = tauriInvoke;
