export interface Settings {
  version: number;
  startupUrl: string;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  opacity: number;
  shortcut: string | null;
  pauseMediaOnHide: boolean;
  accentColor: string;
  cornerRadius: number;
}

export interface Snapshot {
  settings: Settings;
  currentUrl: string;
  warning: string | null;
}
