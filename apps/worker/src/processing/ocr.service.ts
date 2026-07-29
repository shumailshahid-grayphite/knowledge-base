import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * OCR fallback for scanned (image-only) PDF pages. Renders a page to PNG with
 * MuPDF (WASM — no system deps, and unlike pdfjs+canvas it renders reliably in
 * Node) and runs tesseract.js (WASM). Both are lazy-loaded so a load/runtime
 * failure degrades gracefully — OCR returns '' and normal text extraction is
 * unaffected. Only invoked for pages the text layer couldn't produce text for,
 * so text PDFs pay no cost.
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private workerPromise: Promise<any> | null = null;
  private mupdfMod: any = null;

  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return this.config.env.OCR_ENABLED;
  }

  private async mupdf(): Promise<any> {
    if (!this.mupdfMod) this.mupdfMod = await import('mupdf');
    return this.mupdfMod;
  }

  private async tesseract(): Promise<any> {
    if (!this.workerPromise) {
      const { createWorker } = await import('tesseract.js');
      this.workerPromise = createWorker(this.config.env.OCR_LANG);
    }
    return this.workerPromise;
  }

  /**
   * Render page `pageIndex` (0-based) of a PDF to PNG and OCR it. Returns ''
   * (never throws) on any failure so extraction always proceeds.
   */
  async ocrPdfPage(pdfBytes: Buffer, pageIndex: number): Promise<string> {
    if (!this.enabled) return '';
    let doc: any, page: any, pix: any;
    try {
      const mupdf = await this.mupdf();
      doc = mupdf.Document.openDocument(new Uint8Array(pdfBytes), 'application/pdf');
      page = doc.loadPage(pageIndex);
      // 2x scale improves OCR accuracy on small text.
      pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
      const png = Buffer.from(pix.asPNG());
      const worker = await this.tesseract();
      const { data } = await worker.recognize(png);
      return (data?.text ?? '').trim();
    } catch (err) {
      this.logger.warn(`OCR failed for page ${pageIndex + 1}: ${(err as Error).message}`);
      return '';
    } finally {
      pix?.destroy?.();
      page?.destroy?.();
      doc?.destroy?.();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.workerPromise) {
      const w = await this.workerPromise.catch(() => null);
      if (w?.terminate) await w.terminate().catch(() => undefined);
    }
  }
}
