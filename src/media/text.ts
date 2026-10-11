import type { TextStyleInput } from '../core/text-library';
import { fontFamily } from '../core/text-library';
import { textAnimationFrame } from '../core/text-animation';

/** Shared by gallery thumbnails, worker preview and native exports. Units are project pixels. */
export function paintText(
  ctx: Omit<OffscreenCanvasRenderingContext2D, 'canvas'>,
  style: TextStyleInput,
  width: number,
  height: number,
  timeUs = 0,
) {
  ctx.save();
  const frame = textAnimationFrame(style, timeUs);
  ctx.translate(width / 2 + frame.x, height / 2 + frame.y);
  ctx.rotate(frame.rotation);
  ctx.translate(-width / 2, -height / 2);
  const size = style.fontSize ?? 64;
  const align = style.align ?? 'center';
  ctx.font = `${style.italic ? 'italic ' : ''}${style.fontWeight ?? 'normal'} ${size}px ${fontFamily(style.fontFamily)}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const spacing = style.letterSpacing ?? 0;
  const measure = (text: string) =>
    ctx.measureText(text).width +
    Math.max(0, Array.from(text).length - 1) * spacing;
  const lines: string[] = [];
  for (const paragraph of frame.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && measure(next) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  const sweep = ((style.curve ?? 0) * Math.PI) / 180;
  const maxArcHeight = sweep
    ? Math.max(
        ...lines.map(
          (line) =>
            (Math.min(width, measure(line)) / Math.abs(sweep)) *
            (1 - Math.cos(sweep / 2)),
        ),
      )
    : 0;
  const lineHeight = size * 1.25 + maxArcHeight;
  ctx.fillStyle = style.background ?? 'transparent';
  ctx.fillRect(0, 0, width, Math.min(height, lines.length * lineHeight));
  ctx.fillStyle = style.color ?? '#ffffff';
  ctx.strokeStyle = style.outlineColor ?? '#000000';
  ctx.lineWidth = (style.outlineWidth ?? 0) * 2;
  ctx.lineJoin = 'round';
  if (style.shadow) {
    ctx.shadowColor = style.shadow.color;
    // Canvas shadows are device-space values, unlike glyphs and outlines.
    const transform = ctx.getTransform();
    const scale = Math.hypot(transform.a, transform.b);
    ctx.shadowBlur = style.shadow.blur * scale;
    ctx.shadowOffsetX = style.shadow.offsetX * scale;
    ctx.shadowOffsetY = style.shadow.offsetY * scale;
  }
  const glyph = (text: string, x: number, y: number, maxWidth?: number) => {
    if (style.outlineWidth) ctx.strokeText(text, x, y, maxWidth);
    ctx.fillText(text, x, y, maxWidth);
  };
  lines.forEach((line, index) => {
    const y = index * lineHeight;
    if (!sweep && !spacing) {
      glyph(
        line,
        align === 'center' ? width / 2 : align === 'right' ? width : 0,
        y,
        width,
      );
      return;
    }
    const chars = Array.from(line);
    const advance = chars.map((char) => ctx.measureText(char).width);
    const total = Math.max(
      1,
      advance.reduce((a, b) => a + b, 0) +
        Math.max(0, chars.length - 1) * spacing,
    );
    const fit = Math.min(1, width / total);
    const occupied = total * fit;
    const start =
      align === 'center'
        ? (width - occupied) / 2
        : align === 'right'
          ? width - occupied
          : 0;
    const radius = sweep ? occupied / sweep : 0;
    const rise = sweep ? Math.abs(radius * (1 - Math.cos(sweep / 2))) : 0;
    let cursor = 0;
    ctx.textAlign = 'center';
    for (let i = 0; i < chars.length; i++) {
      const center = (cursor + advance[i]! / 2) * fit;
      const angle = sweep ? (center / occupied - 0.5) * sweep : 0;
      ctx.save();
      ctx.translate(
        sweep
          ? start + occupied / 2 + Math.sin(angle) * radius
          : start + center,
        y +
          (sweep ? (sweep < 0 ? rise : 0) + radius * (1 - Math.cos(angle)) : 0),
      );
      ctx.rotate(angle);
      ctx.scale(fit, 1);
      glyph(chars[i]!, 0, 0);
      ctx.restore();
      cursor += advance[i]! + spacing;
    }
  });
  ctx.restore();
}
