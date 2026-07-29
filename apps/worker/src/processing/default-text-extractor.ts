import { Injectable, Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import type {
  ExtractedPage,
  ExtractionResult,
  TextExtractor,
} from './text-extractor.interface.js';
import { OcrService } from './ocr.service.js';

/**
 * Default extractor: pdfjs-dist for per-page PDF text (real page-number
 * citations), mammoth for DOCX, native decode for TXT/Markdown. Pages with no
 * selectable text (scanned) fall back to OCR. pdfjs/mammoth are confined here.
 */
@Injectable()
export class DefaultTextExtractor implements TextExtractor {
  private readonly logger = new Logger(DefaultTextExtractor.name);

  constructor(private readonly ocr: OcrService) {}

  async extract(buffer: Buffer, mimeType: string, fileName: string): Promise<ExtractionResult> {
    if (mimeType === 'application/pdf') {
      return this.extractPdf(buffer, fileName);
    }
    if (mimeType.includes('wordprocessingml')) {
      return this.extractDocx(buffer);
    }
    if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      return this.buildResult([{ pageNumber: null, text: buffer.toString('utf8') }], {}, []);
    }
    throw new Error(`Unsupported mime type for extraction: ${mimeType}`);
  }

  private async extractPdf(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
    const warnings: string[] = [];
    // Dynamic import: pdfjs-dist v4 is ESM; the worker is CJS. Kept local so the
    // dependency never leaks into the rest of the worker.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
    });
    const doc = await loadingTask.promise;

    const metadata: Record<string, unknown> = { numPages: doc.numPages };
    try {
      const info = await doc.getMetadata();
      if (info?.info) {
        metadata.title = info.info.Title;
        metadata.author = info.info.Author;
      }
    } catch {
      /* metadata is best-effort */
    }

    const pages: ExtractedPage[] = [];
    let ocrPages = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let text = content.items
          .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
          .join(' ');
        // Scanned page (no text layer) -> OCR (MuPDF renders the page, tesseract reads it).
        if (!text.trim() && this.ocr.enabled) {
          const ocrText = await this.ocr.ocrPdfPage(buffer, p - 1);
          if (ocrText.trim()) {
            text = ocrText;
            ocrPages += 1;
          }
        }
        pages.push({ pageNumber: p, text });
        if (typeof page.cleanup === 'function') page.cleanup();
      } catch (err) {
        warnings.push(`page ${p} extraction failed: ${(err as Error).message}`);
        // Fall back to a null-page marker so the page isn't silently dropped.
        pages.push({ pageNumber: null, text: '' });
      }
    }
    if (typeof doc.destroy === 'function') await doc.destroy();

    if (ocrPages > 0) {
      this.logger.log(`OCR recovered text for ${ocrPages} scanned page(s) in ${fileName}`);
    }
    if (pages.every((pg) => !pg.text.trim())) {
      warnings.push('no selectable text found (scanned document and OCR produced nothing)');
    }
    this.logger.debug(`extracted ${pages.length} page(s) from ${fileName}`);
    return this.buildResult(pages, metadata, warnings);
  }

  private async extractDocx(buffer: Buffer): Promise<ExtractionResult> {
    const result = await mammoth.extractRawText({ buffer });
    const warnings = (result.messages ?? []).map((m) => `${m.type}: ${m.message}`);
    // DOCX has no reliable page model -> single null-page segment.
    return this.buildResult([{ pageNumber: null, text: result.value }], {}, warnings);
  }

  private buildResult(
    rawPages: ExtractedPage[],
    metadata: Record<string, unknown>,
    warnings: string[],
  ): ExtractionResult {
    const pages = rawPages.map((p) => ({ ...p, text: normalizeText(p.text) }));
    const fullText = pages
      .map((p) => p.text)
      .filter(Boolean)
      .join('\n\n');
    return { fullText, pages, metadata, warnings };
  }
}

/** Light normalization: strip null bytes, normalize newlines, collapse runs of spaces. */
function normalizeText(text: string): string {
  return text
    .replace(/\x00/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
