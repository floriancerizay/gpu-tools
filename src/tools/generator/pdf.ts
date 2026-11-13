import { PDFDocument, StandardFonts } from 'pdf-lib';

export const PDF_TEXT = 'ceci est un doc de test';

export async function fakePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText(PDF_TEXT, { x: 72, y: 760, size: 18, font });
  return pdf.save();
}
