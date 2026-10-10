import type { ClipInput } from './model';

// Only local system families: no network or platform font enumeration.
export const FONT_IDS = [
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
export type FontId = (typeof FONT_IDS)[number];
export const TEXT_FONTS: {
  id: FontId;
  name: string;
  family: string;
  labels: string[];
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
  const haystack =
    `${item.name} ${item.labels.join(' ')} ${item.family ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
