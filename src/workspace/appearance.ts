import { useSyncExternalStore } from 'react';
import type { FontId } from '../core/text-library';

export const APPEARANCE_KEY = 'localcut.appearance.v1';
export const systemAppearanceFonts = [
  {
    id: 'sans',
    name: 'System sans',
    family: 'system-ui, sans-serif',
    labels: ['sans', 'minimal'],
  },
  {
    id: 'serif',
    name: 'System serif',
    family: 'ui-serif, Georgia, serif',
    labels: ['serif', 'classic'],
  },
  {
    id: 'mono',
    name: 'System mono',
    family: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    labels: ['mono', 'code'],
  },
  {
    id: 'arial',
    name: 'Arial',
    family: 'Arial, Helvetica, sans-serif',
    labels: ['sans'],
  },
  {
    id: 'verdana',
    name: 'Verdana',
    family: 'Verdana, Geneva, sans-serif',
    labels: ['sans'],
  },
  {
    id: 'tahoma',
    name: 'Tahoma',
    family: 'Tahoma, Verdana, sans-serif',
    labels: ['sans'],
  },
  {
    id: 'trebuchet',
    name: 'Trebuchet MS',
    family: '"Trebuchet MS", Verdana, sans-serif',
    labels: ['sans'],
  },
  {
    id: 'georgia',
    name: 'Georgia',
    family: 'Georgia, "Times New Roman", serif',
    labels: ['serif'],
  },
  {
    id: 'palatino',
    name: 'Palatino',
    family: 'Palatino, "Palatino Linotype", "Book Antiqua", serif',
    labels: ['serif'],
  },
  {
    id: 'times',
    name: 'Times New Roman',
    family: '"Times New Roman", Times, serif',
    labels: ['serif'],
  },
  {
    id: 'courier',
    name: 'Courier New',
    family: '"Courier New", Courier, monospace',
    labels: ['mono'],
  },
] as const;
export type AppearanceFont =
  FontId | (typeof systemAppearanceFonts)[number]['id'];
const fontOptions: AppearanceFont[] = systemAppearanceFonts.map(
  (font) => font.id,
);
const headingOptions: (AppearanceFont | 'inherit')[] = [
  'inherit',
  ...fontOptions,
];
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
  font: fontOptions,
  heading: headingOptions,
  radius: ['none', 'small', 'medium', 'large'],
  density: ['compact', 'default', 'comfortable'],
  interfaceSize: ['default', 'small', 'large'],
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
  interfaceSize: 'default',
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

const fonts = new Map<string, string>(
  systemAppearanceFonts.map((font) => [font.id, font.family]),
);
let catalog: Promise<typeof import('./appearance-fonts')> | undefined;
export function loadAppearanceFonts() {
  return (catalog ??= import('./appearance-fonts')
    .then((module) => {
      for (const font of module.appearanceFontChoices)
        fonts.set(font.id, font.family);
      fontOptions.splice(
        0,
        fontOptions.length,
        ...module.appearanceFontChoices.map((font) => font.id),
      );
      headingOptions.splice(
        0,
        headingOptions.length,
        'inherit',
        ...fontOptions,
      );
      return module;
    })
    .catch((error) => {
      catalog = undefined;
      throw error;
    }));
}
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

type Snapshot = {
  preferences: Appearance;
  dark: boolean;
  saved: boolean;
  fontLoading: boolean;
  fontError: string;
};
let snapshot: Snapshot = {
  preferences: { ...defaultAppearance },
  dark: false,
  saved: true,
  fontLoading: false,
  fontError: '',
};
const listeners = new Set<() => void>();
let colorScheme: MediaQueryList | undefined;
let initialized = false;
let restoreGeneration = 0;
let pendingRestore: string | null = null;
let fontJob: string | undefined;
let fontGeneration = 0;

function restoreAppearance(raw: string | null) {
  const generation = ++restoreGeneration;
  pendingRestore = null;
  snapshot = {
    ...snapshot,
    preferences: parseAppearance(raw),
    saved: true,
  };
  publish();
  try {
    const record = JSON.parse(raw ?? 'null');
    if (record?.version !== 1) return;
    if (
      !['font', 'heading'].some(
        (key) =>
          typeof record?.preferences?.[key] === 'string' &&
          !fonts.has(record.preferences[key]) &&
          record.preferences[key] !== 'inherit',
      )
    )
      return;
  } catch {
    return;
  }
  pendingRestore = raw;
  void loadAppearanceFonts()
    .then(() => {
      if (generation !== restoreGeneration) return;
      pendingRestore = null;
      snapshot = {
        ...snapshot,
        preferences: parseAppearance(raw),
        fontError: '',
      };
      publish();
    })
    .catch(() => {
      if (generation !== restoreGeneration) return;
      snapshot = { ...snapshot, fontError: 'Could not load the font catalog.' };
      for (const listener of listeners) listener();
    });
}

export function retryAppearanceFonts() {
  if (pendingRestore !== null) restoreAppearance(pendingRestore);
  else {
    fontJob = undefined;
    publish();
  }
}

function apply() {
  const p = snapshot.preferences;
  const dark =
    p.mode === 'dark' || (p.mode === 'system' && !!colorScheme?.matches);
  snapshot = { ...snapshot, dark };
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.density = p.density;
  root.dataset.interfaceSize = p.interfaceSize;
  root.style.setProperty('--interface-scale', String(interfaceScale()));
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
  set('appearance-font-sans', fonts.get(p.font) ?? fonts.get('sans')!);
  set(
    'appearance-font-heading',
    fonts.get(p.heading === 'inherit' ? p.font : p.heading) ??
      fonts.get('sans')!,
  );
  const selected = [p.font, p.heading === 'inherit' ? p.font : p.heading];
  const job = JSON.stringify(selected);
  if (fontJob === job) return;
  fontJob = job;
  const generation = ++fontGeneration;
  const bundled = selected.some((id) => id.startsWith('font-'));
  snapshot = { ...snapshot, fontLoading: bundled, fontError: '' };
  if (!bundled) return;
  void loadAppearanceFonts()
    .then((module) => module.prepareAppearanceFonts(selected))
    .then(() => {
      if (generation !== fontGeneration) return;
      snapshot = { ...snapshot, fontLoading: false };
      publish();
    })
    .catch((error: unknown) => {
      if (generation !== fontGeneration) return;
      snapshot = {
        ...snapshot,
        fontLoading: false,
        fontError:
          error instanceof Error
            ? error.message
            : 'Could not load the selected fonts.',
      };
      for (const listener of listeners) listener();
    });
}

export function interfaceScale() {
  return { default: 1, small: 0.75, large: 1.25 }[
    snapshot.preferences.interfaceSize
  ];
}

function publish() {
  apply();
  for (const listener of listeners) listener();
}

/** Read appearance before React renders, without opening any editing services. */
export function initializeAppearance() {
  if (initialized) return;
  initialized = true;
  let raw: string | null = null;
  let readable = true;
  try {
    raw = localStorage.getItem(APPEARANCE_KEY);
  } catch {
    readable = false;
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
    restoreAppearance(event.newValue);
  });
  restoreAppearance(raw);
  if (!readable) snapshot = { ...snapshot, saved: false };
}

export function saveAppearance(preferences: Appearance, reset = false) {
  restoreGeneration++;
  pendingRestore = null;
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
    if (key === 'mode' || key === 'interfaceSize') continue;
    const options = appearanceOptions[key];
    Object.assign(result, {
      [key]: options[Math.floor(Math.random() * options.length)],
    });
  }
  return result;
}
