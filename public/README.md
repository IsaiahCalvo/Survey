# Public Assets

This folder contains files served directly by the browser and Vite.

- Favicons and PWA icons stay here because `manifest.json` and browser metadata reference root-public paths.
- PDF worker files stay here because the PDF viewer loads them as static browser assets.

Assets imported directly by React components should live under `src/assets/` instead.
