import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { shrinkZip } from '../src/tools/shrink/shrink';

describe('shrinkZip', () => {
  it('remplace les PDF et conserve les autres fichiers', async () => {
    const zip = new JSZip();
    zip.file('a/doc.PDF', 'x'.repeat(10000));
    zip.file('b.pdf', 'y'.repeat(10000));
    zip.file('c.csv', 'a;b');
    const { blob, replaced } = await shrinkZip(await zip.generateAsync({ type: 'uint8array' }));
    expect(replaced).toBe(2);
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await out.file('c.csv')!.async('string')).toBe('a;b');
    const pdf = await out.file('b.pdf')!.async('string');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.length).toBeLessThan(2000);
  });
});
