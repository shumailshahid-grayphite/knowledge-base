/**
 * Extraction boundary. The pipeline depends ONLY on this interface, so the
 * concrete extractor (pdfjs-dist/mammoth today) can be swapped for Docling,
 * Unstructured, Azure Document Intelligence, or a Python service later without
 * touching DocumentProcessor.
 */

export interface ExtractedPage {
  /** 1-based page number for PDFs; null when the format has no page concept. */
  pageNumber: number | null;
  text: string;
}

export interface ExtractionResult {
  fullText: string;
  pages: ExtractedPage[];
  metadata: Record<string, unknown>;
  /** Non-fatal issues (e.g. a page that failed to render). */
  warnings: string[];
}

export interface TextExtractor {
  extract(buffer: Buffer, mimeType: string, fileName: string): Promise<ExtractionResult>;
}

export const TEXT_EXTRACTOR = Symbol('TEXT_EXTRACTOR');
