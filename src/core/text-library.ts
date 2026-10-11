import type { ClipInput } from './model';
import bundledFonts from './bundled-fonts.json' with { type: 'json' };

export const LEGACY_FONT_IDS = [
  'sans',
  'rounded',
  'handwritten',
  'script',
  'serif',
  'editorial',
  'slab',
  'mono',
  'display',
  'condensed',
] as const;
export type FontId = (typeof LEGACY_FONT_IDS)[number] | `font-${string}`;
export const FONT_IDS = [
  ...LEGACY_FONT_IDS,
  ...bundledFonts.map((font) => font.id as FontId),
] as const;
export const TEXT_FONTS: {
  id: FontId;
  name: string;
  family: string;
  labels: string[];
  sample?: string;
}[] = [
  {
    id: 'sans',
    name: 'Clean sans',
    family: 'Arial, Helvetica, sans-serif',
    labels: ['minimal', 'modern', 'simple'],
  },
  {
    id: 'rounded',
    name: 'Soft rounded',
    family: '"Arial Rounded MT Bold", "Trebuchet MS", sans-serif',
    labels: ['cute', 'friendly', 'rounded'],
  },
  {
    id: 'handwritten',
    name: 'Playful handwritten',
    family: '"Chalkboard SE", "Comic Sans MS", cursive',
    labels: ['cute', 'casual', 'handwriting'],
  },
  {
    id: 'script',
    name: 'Flowing script',
    family: '"Snell Roundhand", "Segoe Script", cursive',
    labels: ['elegant', 'script', 'romantic'],
  },
  {
    id: 'serif',
    name: 'Classic serif',
    family: 'Georgia, "Times New Roman", serif',
    labels: ['classic', 'serif', 'elegant'],
  },
  {
    id: 'editorial',
    name: 'Editorial',
    family: 'Didot, "Bodoni MT", "Times New Roman", serif',
    labels: ['fashion', 'luxury', 'serif'],
  },
  {
    id: 'slab',
    name: 'Bold slab',
    family: 'Rockwell, "Courier New", serif',
    labels: ['retro', 'slab', 'bold'],
  },
  {
    id: 'mono',
    name: 'Minimal mono',
    family: 'Menlo, Consolas, monospace',
    labels: ['minimal', 'code', 'monospace'],
  },
  {
    id: 'display',
    name: 'Big display',
    family: 'Impact, Haettenschweiler, sans-serif',
    labels: ['bold', 'poster', 'display'],
  },
  {
    id: 'condensed',
    name: 'Narrow sans',
    family: '"Arial Narrow", "Avenir Next Condensed", sans-serif',
    labels: ['minimal', 'condensed', 'headline'],
  },
  ...bundledFonts.map((font) => ({ ...font, id: font.id as FontId })),
];
export function fontFamily(id: FontId = 'sans') {
  return TEXT_FONTS.find((font) => font.id === id)!.family;
}
export type TextStyleInput = NonNullable<ClipInput['text']>;
export interface TextTemplate {
  id: string;
  name: string;
  labels: string[];
  style: TextStyleInput;
}
export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: 'typewriter',
    name: 'Typewriter',
    labels: ['animated', 'typing', 'typewriter', 'minimal'],
    style: {
      text: 'Your story starts here',
      fontSize: 88,
      fontFamily: 'font-special-elite',
      animation: { kind: 'typewriter', stepMs: 90, loop: false },
    },
  },
  {
    id: 'typing-loop',
    name: 'Typing loop',
    labels: ['animated', 'typing', 'loop', 'code'],
    style: {
      text: 'hello, world!',
      fontSize: 88,
      fontFamily: 'font-space-mono',
      animation: { kind: 'typewriter', stepMs: 120, loop: true },
    },
  },
  ...([3, 4, 5] as const).map((frames) => ({
    id: `handmade-${frames}`,
    name: `Handmade ${frames} frames`,
    labels: [
      'animated',
      'cute',
      'handcrafted',
      'handmade',
      'wiggle',
      'loop',
      'stop-motion',
    ],
    style: {
      text: 'little happy things',
      fontSize: 88,
      fontFamily: 'font-patrick-hand' as FontId,
      color: '#f9a8d4',
      animation: { kind: 'handmade' as const, stepMs: 180, frames, loop: true },
    },
  })),
  {
    id: 'plain',
    name: 'Plain text',
    labels: ['minimal', 'simple'],
    style: { text: 'Your story starts here', fontSize: 64, fontFamily: 'sans' },
  },
  {
    id: 'cute',
    name: 'Little moments',
    labels: ['cute', 'rounded', 'pink'],
    style: {
      text: 'little moments',
      fontSize: 88,
      fontFamily: 'rounded',
      color: '#f9a8d4',
      fontWeight: 'bold',
    },
  },
  {
    id: 'handwritten',
    name: 'Dear diary',
    labels: ['cute', 'handwriting'],
    style: {
      text: 'dear diary…',
      fontSize: 88,
      fontFamily: 'handwritten',
      color: '#fde68a',
    },
  },
  {
    id: 'minimal',
    name: 'Less is more',
    labels: ['minimal', 'spaced'],
    style: {
      text: 'LESS IS MORE',
      fontSize: 58,
      fontFamily: 'sans',
      letterSpacing: 10,
    },
  },
  {
    id: 'bold',
    name: 'Big statement',
    labels: ['bold', 'display', 'headline'],
    style: {
      text: 'MAKE IT HAPPEN',
      fontSize: 120,
      fontFamily: 'display',
      fontWeight: 'bold',
    },
  },
  {
    id: 'curve',
    name: 'Around the sun',
    labels: ['curved', 'cute', 'arc'],
    style: {
      text: 'AROUND THE SUN',
      fontSize: 90,
      fontFamily: 'rounded',
      curve: 100,
      fontWeight: 'bold',
      color: '#fcd34d',
    },
  },
  {
    id: 'shadow',
    name: 'Soft shadow',
    labels: ['shadowed', 'bold'],
    style: {
      text: 'Dream bigger',
      fontSize: 100,
      fontFamily: 'sans',
      fontWeight: 'bold',
      shadow: { color: '#a855f7', blur: 12, offsetX: 8, offsetY: 8 },
    },
  },
  {
    id: 'highlight',
    name: 'Highlight',
    labels: ['highlighted', 'marker', 'bold'],
    style: {
      text: 'Worth remembering',
      fontSize: 80,
      fontFamily: 'sans',
      color: '#18181b',
      background: '#fde047',
      fontWeight: 'bold',
    },
  },
  {
    id: 'outline',
    name: 'Outline',
    labels: ['outlined', 'poster'],
    style: {
      text: 'STAND OUT',
      fontSize: 110,
      fontFamily: 'display',
      color: '#ffffff',
      outlineColor: '#f97316',
      outlineWidth: 5,
    },
  },
  {
    id: 'script',
    name: 'With love',
    labels: ['script', 'elegant', 'italic'],
    style: {
      text: 'with love',
      fontSize: 110,
      fontFamily: 'script',
      italic: true,
    },
  },
  {
    id: 'editorial',
    name: 'The editorial',
    labels: ['serif', 'luxury', 'classic'],
    style: { text: 'A new perspective', fontSize: 96, fontFamily: 'editorial' },
  },
  {
    id: 'retro',
    name: 'Retro postcard',
    labels: ['retro', 'slab', 'shadowed'],
    style: {
      text: 'GOOD TIMES',
      fontSize: 100,
      fontFamily: 'slab',
      fontWeight: 'bold',
      color: '#fdba74',
      shadow: { color: '#9a3412', blur: 0, offsetX: 6, offsetY: 6 },
    },
  },
];
export function matchesTextLabels(
  item: { name: string; labels: string[]; family?: string },
  query: string,
) {
  // CSS fallback categories are not names: searching serif must not match every sans-serif face.
  const families = (item.family ?? '')
    .split(',')
    .filter(
      (family) =>
        ![
          'sans-serif',
          'serif',
          'monospace',
          'cursive',
          'fantasy',
          'system-ui',
        ].includes(family.trim()),
    );
  const names = `${item.name} ${families.join(' ')}`.toLowerCase();
  const labels = item.labels.map((label) => label.toLowerCase());
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every(
      (word) =>
        names.includes(word) || labels.some((label) => label.startsWith(word)),
    );
}
