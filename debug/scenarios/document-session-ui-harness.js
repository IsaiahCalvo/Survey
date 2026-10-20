// Vite resolves these imports through the server's own cacheDir. Importing a
// hardcoded .vite URL in a browser test could create a second React instance.
import React from 'react';
import { createRoot } from 'react-dom/client';
export { React, createRoot };
