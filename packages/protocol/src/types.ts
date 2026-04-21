// ─── View Hierarchy ──────────────────────────────────────────────

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewNode {
  type: string;
  label?: string;
  identifier?: string;
  /** Full Android resource-id (e.g. "com.example:id/login_button") */
  resourceId?: string;
  value?: string;
  text?: string;
  placeholder?: string;

  isVisible: boolean;
  isEnabled: boolean;
  isSelected?: boolean;
  isFocused?: boolean;
  isChecked?: boolean;

  bounds: Bounds;
  children: ViewNode[];

  /** Platform-specific raw attributes */
  raw?: Record<string, unknown>;
}

// ─── Device ──────────────────────────────────────────────────────

export type Platform = 'ios' | 'android';
export type DeviceType = 'real' | 'simulator' | 'emulator';
export type DeviceState = 'online' | 'offline';

export interface DeviceInfo {
  id: string;
  name: string;
  platform: Platform;
  type: DeviceType;
  state: DeviceState;
  model?: string;
  osVersion?: string;
}

// ─── App ─────────────────────────────────────────────────────────

export interface AppInfo {
  bundleId: string;
  name?: string;
  version?: string;
}

export interface LaunchOptions {
  /** BCP 47 locale tags (e.g. ['fr-FR', 'en-GB']) */
  locales?: string[];
}

// ─── Connection ──────────────────────────────────────────────────

export interface ConnectionConfig {
  /** WebSocket or HTTP URL of the server */
  url?: string;
  /** Target platform (required). */
  platform: Platform;
  /** Specific device identifier (local drivers only). */
  deviceId?: string;
  /** Regex or string to match device name. */
  deviceName?: RegExp | string;
  /** OS version filter (e.g. '18.0', '>=17'). */
  osVersion?: string;
  /** Connection timeout in ms */
  timeout?: number;
}

export interface Session {
  deviceId: string;
  platform: Platform;
}

// ─── Input ───────────────────────────────────────────────────────

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export interface SwipeOptions {
  /** Distance in points (default: 50% of screen dimension) */
  distance?: number;
  /** Duration of swipe in ms */
  duration?: number;
  /** Starting x,y (default: center of screen) */
  startX?: number;
  startY?: number;
}

export type HardwareButton =
  | 'HOME'
  | 'BACK'
  | 'POWER'
  | 'VOLUME_UP'
  | 'VOLUME_DOWN'
  | 'ENTER'
  | 'DPAD_UP'
  | 'DPAD_DOWN'
  | 'DPAD_LEFT'
  | 'DPAD_RIGHT'
  | 'DPAD_CENTER'
  | 'APP_SWITCH';

export type Orientation = 'portrait' | 'landscape';

export interface GesturePoint {
  x: number;
  y: number;
  /** Time offset from start in ms */
  time?: number;
}

export interface GestureSequence {
  /** Each sub-array is a finger/pointer path */
  pointers: GesturePoint[][];
}

// ─── Screen ──────────────────────────────────────────────────────

export type ScreenshotFormat = 'png' | 'jpeg';

export interface ScreenshotOptions {
  format?: ScreenshotFormat;
  quality?: number;
  path?: string;
}

export interface ScreenSize {
  width: number;
  height: number;
  scale: number;
}

// ─── List Devices ────────────────────────────────────────────────

export interface ListDevicesOptions {
  platform?: Platform;
  state?: DeviceState;
}

// ─── Recording ──────────────────────────────────────────────────

export interface RecordingOptions {
  /** Output file path for the video (MP4) */
  output: string;
  /** Max recording duration in seconds (0 = no limit) */
  timeLimit?: number;
}

export interface RecordingResult {
  /** Path to the output video file */
  output: string;
  /** Human-readable duration string */
  duration?: string;
}
