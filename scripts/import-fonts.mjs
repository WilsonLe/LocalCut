import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './build-state.mjs';

// Explicit maintenance operation; never runs during install, build, or app startup.
const revision = '77f00efe046239b4bff0c1b5569ae67813401315';
const base = `https://raw.githubusercontent.com/fontsource/google-font-metadata/${revision}/data/`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function download(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await globalThis.fetch(url, {
        signal: globalThis.AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
const metadata = await download(base + 'google-fonts-v1.json');
const licensing = await download(base + 'licenses.json');
const unicodeMetadata = await download(base + 'google-fonts-v2.json');
const unicodeFonts = JSON.parse(unicodeMetadata);
const fonts = JSON.parse(metadata);
const licenses = JSON.parse(licensing);
const directory = join(root, 'public/fonts');
await mkdir(directory, { recursive: true });
const entries = [];
const excluded = [];
const pending = [];
const lock = {
  revision,
  metadataSha256: sha256(metadata),
  unicodeMetadataSha256: sha256(unicodeMetadata),
  licensesSha256: sha256(licensing),
  families: [],
  excluded,
};
const categoryTags = {
  'sans-serif': ['sans', 'sans-serif', 'modern', 'minimal'],
  serif: ['serif', 'classic', 'editorial'],
  display: ['display', 'poster', 'headline'],
  handwriting: ['handwriting', 'handwritten', 'script', 'casual'],
  monospace: ['monospace', 'mono', 'code', 'minimal'],
};
const cute = new Set([
  'baloo-2',
  'balsamiq-sans',
  'bubblegum-sans',
  'chewy',
  'comfortaa',
  'delius',
  'delius-swash-caps',
  'fredoka',
  'gloria-hallelujah',
  'indie-flower',
  'kalam',
  'nanum-pen-script',
  'patrick-hand',
  'schoolbell',
  'short-stack',
  'sniglet',
  'sue-ellen-francisco',
]);
for (const [id, font] of Object.entries(fonts)) {
  const license = licenses[id];
  if (!license || !font.styles.includes('normal')) {
    excluded.push({
      id,
      reason: !license
        ? 'No verified license in pinned metadata'
        : 'No upright face in pinned metadata',
    });
    continue;
  }
  const weight = String(
    font.weights.reduce((a, b) =>
      Math.abs(a - 400) <= Math.abs(b - 400) ? a : b,
    ),
  );
  const familyDir = join(directory, id);
  await mkdir(familyDir, { recursive: true });
  const labels = [
    ...(categoryTags[font.category] ?? [font.category]),
    ...font.subsets.filter((subset) => !subset.endsWith('-ext')),
  ];
  if (cute.has(id)) labels.push('cute', 'friendly', 'playful');
  if (/round|baloo|fredoka|comfortaa|sniglet/.test(id))
    labels.push('rounded', 'cute');
  if (/condensed|narrow|oswald|anton|bebas/.test(id))
    labels.push('condensed', 'bold');
  if (/slab/.test(id)) labels.push('slab', 'retro');
  if (/script|calligraphy|cursive|dancing|satisfy|pacifico/.test(id))
    labels.push('script', 'romantic');
  const entry = {
    id: `font-${id}`,
    name: font.family,
    family: `"LocalCut ${id}", ${font.category === 'handwriting' ? 'cursive' : font.category === 'display' ? 'sans-serif' : font.category}`,
    labels: [...new Set(labels)],
  };
  if (!font.subsets.includes('latin')) {
    entry.sample = {
      khmer: 'សួស្តី',
      tamil: 'வணக்கம்',
      emoji: '✨ 🌷 🐻',
      lycian: '𐊀𐊁𐊂𐊃',
      myanmar: 'မင်္ဂလာပါ',
      lao: 'ສະບາຍດີ',
    }[font.defSubset];
    if (!entry.sample) throw new Error(`No native-script sample for ${id}`);
  }
  entries.push(entry);
  const manifest = {
    family: `LocalCut ${id}`,
    weight: Number(weight),
    files: [],
  };
  const previous = await readFile(join(familyDir, 'manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => undefined);
  for (const [subset, variant] of Object.entries(
    font.variants[weight].normal,
  )) {
    const url = variant.url.woff2;
    if (!url) throw new Error(`No WOFF2: ${id}/${subset}`);
    pending.push(async () => {
      const file = `${subset}.woff2`;
      const path = join(familyDir, file);
      const saved = previous?.files.find(
        (item) => item.file === file && item.source === url,
      );
      let bytes = await readFile(path).catch(() => undefined);
      if (!bytes || !saved || sha256(bytes) !== saved.sha256)
        bytes = await download(url);
      if (bytes.subarray(0, 4).toString() !== 'wOF2')
        throw new Error(`Invalid font: ${url}`);
      await writeFile(path, bytes);
      const ranges = unicodeFonts[id].unicodeRange;
      const unicodeRange =
        ranges[subset] ??
        Object.entries(ranges)
          .filter(([name]) => name.startsWith('['))
          .map(([, range]) => range)
          .join(',');
      if (!unicodeRange) throw new Error(`No Unicode range: ${id}/${subset}`);
      manifest.files.push({
        file,
        subset,
        unicodeRange,
        sha256: sha256(bytes),
        bytes: bytes.length,
        source: url,
      });
    });
  }
  lock.families.push({
    id,
    version: font.version,
    weight: Number(weight),
    license: license.license.type,
    copyright: license.original,
  });
  await writeFile(
    join(familyDir, 'LICENSE.txt'),
    `${license.original}\n\n${license.license.type}\n${license.license.url}\n\n` +
      (await readFile(
        join(
          root,
          'public/notices/fonts',
          license.license.type.startsWith('SIL')
            ? 'OFL.txt'
            : license.license.type.startsWith('Apache')
              ? 'Apache.txt'
              : 'UFL.txt',
        ),
        'utf8',
      )),
  );
  // Write only after every family task completes below.
  entry.manifest = manifest;
}
let next = 0;
await Promise.all(
  Array.from({ length: 12 }, async () => {
    while (next < pending.length) {
      const index = next++;
      await pending[index]();
      if ((index + 1) % 200 === 0)
        console.log(`Fonts: ${index + 1}/${pending.length}`);
    }
  }),
);
for (const entry of entries) {
  entry.manifest.files.sort((a, b) => a.subset.localeCompare(b.subset));
  await writeFile(
    join(directory, entry.id.slice(5), 'manifest.json'),
    JSON.stringify(entry.manifest, null, 2) + '\n',
  );
  delete entry.manifest;
}
await writeFile(
  join(directory, 'catalog-lock.json'),
  JSON.stringify(lock, null, 2) + '\n',
);
await writeFile(
  join(root, 'src/core/bundled-fonts.json'),
  JSON.stringify(entries, null, 2) + '\n',
);
console.log(
  `Bundled ${entries.length} families, ${pending.length} subsets; ${excluded.length} exclusions recorded.`,
);
