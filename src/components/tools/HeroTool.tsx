import { useEffect, useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import CompressTool from './CompressTool';
import PdfCompressTool from './PdfCompressTool';
import { isPdf } from '../../lib/pdf';
import { warmUp } from '../../lib/codec';

/**
 * The home page's single box: a photo opens the "compress to KB" tool,
 * a PDF opens the PDF compressor, both in place.
 */
export default function HeroTool() {
  const [picked, setPicked] = useState<{ file: File; kind: 'image' | 'pdf' } | null>(null);
  // Load the image engine now, so photos still work if the connection drops later.
  useEffect(() => warmUp(), []);

  const choose = async (files: File[]) => {
    const file = files[0];
    setPicked({ file, kind: (await isPdf(file)) ? 'pdf' : 'image' });
  };

  if (!picked) {
    return (
      <Dropzone
        onFiles={choose}
        accept="image/*,.heic,.heif,application/pdf,.pdf"
        label="Choose a photo or PDF"
        hint="or drop it here. JPG, PNG, WebP, iPhone HEIC or PDF."
      />
    );
  }
  return picked.kind === 'pdf' ? (
    <PdfCompressTool initialFile={picked.file} defaultMaxKb={200} />
  ) : (
    <CompressTool initialFile={picked.file} defaultMaxKb={50} />
  );
}
