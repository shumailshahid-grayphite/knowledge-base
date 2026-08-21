import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import type { UploadedFileLike } from '../common/types.js';

/** Upper bound on extracted attachment text (matches the QueryAttachment DTO cap). */
const MAX_CHARS = 50000;

/**
 * Synchronous text extraction for an attached draft (PDF / DOCX / TXT / MD). This
 * is the interactive counterpart to the worker's ingest extractor: it runs inline
 * on the request so the user can attach a draft to a chat turn WITHOUT the file
 * ever entering the knowledge base. No OCR here — attachments are expected to have
 * a text layer; scanned files degrade to whatever text is present.
 */
@Injectable()
export class AttachmentExtractorService {
  private readonly logger = new Logger(AttachmentExtractorService.name);

  async extract(file: UploadedFileLike | undefined): Promise<{ name: string; text: string }> {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    const name = file.originalname || 'attachment';
    const mime = file.mimetype;

    let text: string;
    if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      text = await this.extractPdf(file.buffer);
    } else if (mime.includes('wordprocessingml') || name.toLowerCase().endsWith('.docx')) {
      text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
    } else if (
      mime.startsWith('text/') ||
      /\.(txt|md|markdown)$/i.test(name)
    ) {
      text = file.buffer.toString('utf8');
    } else {
      throw new BadRequestException(`Unsupported attachment type: ${mime || name}`);
    }

    text = normalize(text);
    if (!text) {
      throw new BadRequestException('Could not extract any text from this file');
    }
    return { name, text: text.slice(0, MAX_CHARS) };
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    // Dynamic import: pdfjs-dist v4 is ESM; the API is CJS. Confined to this method.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;

    const parts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        parts.push(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content.items.map((it: any) => (typeof it.str === 'string' ? it.str : '')).join(' '),
        );
        if (typeof page.cleanup === 'function') page.cleanup();
      } catch (err) {
        this.logger.warn(`attachment PDF page ${p} failed: ${(err as Error).message}`);
      }
    }
    if (typeof doc.destroy === 'function') await doc.destroy();
    return parts.join('\n\n');
  }
}

function normalize(text: string): string {
  return text
    .replace(/\x00/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
