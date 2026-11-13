import JSZip from 'jszip';
import { placeholderPdf } from './placeholder-pdf';

export interface ShrinkResult {
  blob: Blob;
  replaced: number;
}

/** Remplace tous les PDF d'une archive ZIP par le PDF de substitution. */
export async function shrinkZip(
  file: Blob | ArrayBuffer | Uint8Array,
  pdf = placeholderPdf(),
): Promise<ShrinkResult> {
  const zip = await JSZip.loadAsync(file);
  const entries = zip.file(/\.pdf$/i);
  entries.forEach((entry) => zip.file(entry.name, pdf));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, replaced: entries.length };
}
