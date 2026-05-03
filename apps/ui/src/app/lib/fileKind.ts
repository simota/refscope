// Shared file-kind classification + color/label lookup.
// Used by Pulse and Stream lenses so the visual vocabulary stays consistent
// across views. When a path is reclassified or a color is retuned, every
// surface that opts into this module follows automatically.

export type FileKind =
  | 'code'
  | 'style'
  | 'config'
  | 'markup'
  | 'docs'
  | 'test'
  | 'asset'
  | 'other';

const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'rs', 'rb', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'h', 'hpp', 'php', 'sh', 'bash', 'zsh',
  'lua', 'dart', 'ex', 'exs', 'erl', 'clj', 'scala',
]);
const STYLE_EXT = new Set(['css', 'scss', 'sass', 'less', 'postcss', 'styl']);
const CONFIG_EXT = new Set(['json', 'yml', 'yaml', 'toml', 'ini', 'env', 'lock']);
const MARKUP_EXT = new Set(['html', 'xml', 'vue', 'svelte', 'astro']);
const DOCS_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);
const ASSET_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'otf',
  'mp3', 'mp4', 'wav', 'webm',
]);

export function classifyFile(path: string): FileKind {
  if (/\.(test|spec)\.[a-z0-9]+$/i.test(path)) return 'test';
  const m = path.match(/\.([a-z0-9]+)$/i);
  const ext = m ? m[1].toLowerCase() : '';
  if (CODE_EXT.has(ext)) return 'code';
  if (STYLE_EXT.has(ext)) return 'style';
  if (CONFIG_EXT.has(ext)) return 'config';
  if (MARKUP_EXT.has(ext)) return 'markup';
  if (DOCS_EXT.has(ext)) return 'docs';
  if (ASSET_EXT.has(ext)) return 'asset';
  return 'other';
}

export function colorForKind(kind: FileKind): string {
  switch (kind) {
    case 'code':   return '#3b82f6';
    case 'style':  return '#ec4899';
    case 'config': return '#f59e0b';
    case 'markup': return '#8b5cf6';
    case 'docs':   return '#64748b';
    case 'test':   return '#22c55e';
    case 'asset':  return '#14b8a6';
    case 'other':  return '#94a3b8';
  }
}

export function labelForKind(kind: FileKind): string {
  switch (kind) {
    case 'code':   return 'Code';
    case 'style':  return 'Style';
    case 'config': return 'Config';
    case 'markup': return 'Markup';
    case 'docs':   return 'Docs';
    case 'test':   return 'Test';
    case 'asset':  return 'Asset';
    case 'other':  return 'Other';
  }
}
