import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Builds a real, valid one-page PDF whose page shows `title`. */
export async function makePdf(title: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const page = doc.addPage([420, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 40, y: 220, size: 20, font });
  return Buffer.from(await doc.save());
}

export function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}
