import { useSyncExternalStore } from 'react';

export const APPEARANCE_KEY = 'localcut.appearance.v1';
export const appearanceOptions = {
  mode: ['light', 'dark', 'system'],
  base: ['neutral', 'stone', 'zinc', 'gray', 'slate'],
  theme: [
    'neutral',
    'blue',
    'green',
    'orange',
    'red',
    'rose',
    'violet',
    'yellow',
  ],
  font: ['sans', 'serif', 'mono'],
  heading: ['inherit', 'sans', 'serif', 'mono'],
  radius: ['none', 'small', 'medium', 'large'],
  density: ['compact', 'default', 'comfortable'],
  menuColor: ['default', 'tinted'],
  menuAccent: ['subtle', 'bold'],
} as const;
export type Appearance = {
  [
    Key in keyof typeof appearanceOptions
  ]: (typeof appearanceOptions)[Key][number];
};
export const defaultAppearance: Appearance = {
  mode: 'light',
  base: 'neutral',
  theme: 'neutral',
  font: 'sans',
  heading: 'inherit',
  radius: 'medium',
  density: 'default',
  menuColor: 'default',
  menuAccent: 'subtle',
};

/** Unknown versions and invalid records never become executable CSS. */
function parseAppearance(raw: string | null): Appearance {
  try {
    const record: unknown = JSON.parse(raw ?? 'null');
    if (
      !record ||
      typeof record !== 'object' ||
      !('version' in record) ||
      record.version !== 1 ||
      !('preferences' in record)
    )
      return { ...defaultAppearance };
    const preferences = record.preferences;
    if (!preferences || typeof preferences !== 'object')
      return { ...defaultAppearance };
    const result = { ...defaultAppearance };
    for (const key of Object.keys(appearanceOptions) as (keyof Appearance)[]) {
      const value = (preferences as Record<string, unknown>)[key];
      if (
        typeof value === 'string' &&
        (appearanceOptions[key] as readonly string[]).includes(value)
      )
        Object.assign(result, { [key]: value });
    }
    return result;
  } catch {
    return { ...defaultAppearance };
  }
}

const fonts = {
  sans: 'system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Consolas, monospace',
};
const bases = {
  neutral: [0, 0],
  stone: [0.008, 60],
  zinc: [0.006, 286],
  gray: [0.012, 260],
  slate: [0.022, 265],
} as const;
// Accent pairs keep readable foregrounds in both appearance modes.
export const themeColors = {
  neutral: [0, 0, 0.205, 0.922],
  blue: [0.214, 259.815, 0.488, 0.707],
  green: [0.17, 149.579, 0.448, 0.792],
  orange: [0.18, 38.402, 0.47, 0.75],
  red: [0.215, 27.325, 0.505, 0.75],
  rose: [0.21, 16.439, 0.514, 0.78],
  violet: [0.25, 292.717, 0.491, 0.811],
  yellow: [0.16, 96, 0.852, 0.852],
} as const;

type Snapshot = { preferences: Appearance; dark: boolean; saved: boolean };
let snapshot: Snapshot = {
  preferences: { ...defaultAppearance },
  dark: false,
  saved: true,
};
const listeners = new Set<() => void>();
let colorScheme: MediaQueryList | undefined;
let initialized = false;

function apply() {
  const p = snapshot.preferences;
  const dark =
    p.mode === 'dark' || (p.mode === 'system' && !!colorScheme?.matches);
  snapshot = { ...snapshot, dark };
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.density = p.density;
  root.dataset.menuAccent = p.menuAccent;
  const set = (name: string, value: string) =>
    root.style.setProperty(`--${name}`, value);
  const [chroma, hue] = bases[p.base];
  const color = (lightness: number) => `oklch(${lightness} ${chroma} ${hue})`;
  const tokens = dark
    ? {
        background: 0.145,
        foreground: 0.985,
        card: 0.205,
        secondary: 0.269,
        muted: 0.269,
        'muted-foreground': 0.708,
        border: 0.32,
        input: 0.36,
      }
    : {
        background: 1,
        foreground: 0.145,
        card: 1,
        secondary: 0.97,
        muted: 0.97,
        'muted-foreground': 0.556,
        border: 0.922,
        input: 0.922,
      };
  for (const [name, lightness] of Object.entries(tokens))
    set(name, color(lightness));
  for (const name of [
    'card-foreground',
    'secondary-foreground',
    'popover-foreground',
    'accent-foreground',
  ])
    set(name, color(dark ? 0.985 : 0.145));
  const [accentChroma, accentHue, light, night] = themeColors[p.theme];
  const primary = `oklch(${dark ? night : light} ${accentChroma} ${accentHue})`;
  const primaryForeground =
    p.theme === 'yellow' || dark ? 'oklch(0.145 0 0)' : 'oklch(0.985 0 0)';
  set('primary', primary);
  set('primary-foreground', primaryForeground);
  set('ring', primary);
  set('accent', p.menuAccent === 'bold' ? primary : color(dark ? 0.269 : 0.97));
  if (p.menuAccent === 'bold') set('accent-foreground', primaryForeground);
  set(
    'popover',
    p.menuColor === 'tinted'
      ? `color-mix(in oklch, ${color(dark ? 0.205 : 1)}, ${primary} 8%)`
      : color(dark ? 0.205 : 1),
  );
  set(
    'radius',
    { none: '0rem', small: '0.3rem', medium: '0.625rem', large: '1rem' }[
      p.radius
    ],
  );
  set('appearance-font-sans', fonts[p.font]);
  set(
    'appearance-font-heading',
    fonts[p.heading === 'inherit' ? p.font : p.heading],
  );
}

function publish() {
  apply();
  for (const listener of listeners) listener();
}

/** Read appearance before React renders, without opening any editing services. */
export function initializeAppearance() {
  if (initialized) return;
  initialized = true;
  try {
    snapshot = {
      ...snapshot,
      preferences: parseAppearance(localStorage.getItem(APPEARANCE_KEY)),
    };
  } catch {
    snapshot = { ...snapshot, saved: false };
  }
  colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  colorScheme.addEventListener('change', publish);
  window.addEventListener('storage', (event) => {
    try {
      if (
        event.storageArea !== localStorage ||
        (event.key !== APPEARANCE_KEY && event.key !== null)
      )
        return;
    } catch {
      return;
    }
    snapshot = {
      ...snapshot,
      preferences: parseAppearance(event.newValue),
      saved: true,
    };
    publish();
  });
  apply();
}

export function saveAppearance(preferences: Appearance, reset = false) {
  let saved = true;
  try {
    if (reset) localStorage.removeItem(APPEARANCE_KEY);
    else
      localStorage.setItem(
        APPEARANCE_KEY,
        JSON.stringify({ version: 1, preferences }),
      );
  } catch {
    saved = false;
  }
  snapshot = { ...snapshot, preferences: { ...preferences }, saved };
  publish();
  return saved;
}

export const getAppearance = () => snapshot;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useAppearance() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function randomAppearance(): Appearance {
  const result = { ...snapshot.preferences };
  for (const key of Object.keys(appearanceOptions) as (keyof Appearance)[]) {
    if (key === 'mode') continue;
    const options = appearanceOptions[key];
    Object.assign(result, {
      [key]: options[Math.floor(Math.random() * options.length)],
    });
  }
  return result;
}
