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
  parameters: Parameters;
  dragShape: DragShape;
  previewEpoch: number;
}

export interface ApplyOutcome {
  settings: Settings;
  warnings: string[];
  navigationFailed: boolean;
  previewEpoch: number;
}

export interface Parameters {
  defaults: Settings;
  limits: {
    minWidth: number; minHeight: number; maxSize: number;
    minOpacity: number; maxOpacity: number;
    minCornerRadius: number; maxCornerRadius: number; cornerRadiusStep: number;
  };
  layout: {
    dragWidth: number; dragHeight: number; arcThreshold: number; arcThickness: number;
    arcLength: number; arcInset: number; panelPadding: number; panelWidth: number;
    panelHeight: number; panelRadius: number; menuWidth: number; menuHeight: number;
    menuRadius: number; resizeGrip: number;
  };
}

export interface DragShape {
  x: number; y: number; width: number; height: number;
  arc: boolean; points: [number, number][]; grip: [number, number];
}
