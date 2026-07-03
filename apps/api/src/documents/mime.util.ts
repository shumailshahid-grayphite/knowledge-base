import { SUPPORTED_MIME_TYPES } from '@kb/shared';

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
};

const SUPPORTED = new Set<string>(SUPPORTED_MIME_TYPES);

/**
 * Resolve a supported MIME type from the browser-provided type, falling back to
 * the file extension (browsers are unreliable for .md/.txt). Returns null if
 * the file type is unsupported by the MVP pipeline.
 */
export function resolveSupportedMime(originalName: string, providedMime?: string): string | null {
  if (providedMime && SUPPORTED.has(providedMime)) {
    return providedMime;
  }
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  const byExt = EXT_TO_MIME[ext];
  if (byExt && SUPPORTED.has(byExt)) {
    return byExt;
  }
  return null;
}

/** Strip path separators / control chars so a filename is safe in a storage key. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'file';
}
