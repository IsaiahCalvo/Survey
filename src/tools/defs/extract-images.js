// Extract images: save every picture inside a PDF, in a ZIP when there are
// several.
import { base } from '../kit.js';

export default {
  view: 'pages',
  options: [
    { key: 'skipSmall', label: 'Skip small images like icons', type: 'check', def: true },
  ],
  async run([file], opts, progress) {
    const { extractImages } = await import('../extractImages.js');
    const { files, failed } = await extractImages(file.bytes, {
      prefix: base(file.name),
      skipSmall: opts.skipSmall,
      onPage: (i, n) => progress(`Page ${i + 1} of ${n}`),
    });
    if (failed) {
      // The note shows on the result; with a ZIP it goes on the first part.
      files[0].note = `${failed} picture${failed === 1 ? '' : 's'} couldn't be saved because ${failed === 1 ? 'it uses' : 'they use'} a kind this tool can't read yet.`;
    }
    return files;
  },
};
