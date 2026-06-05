// YDocContext lives in its own module to break the import cycle between
// YDocProvider.jsx and its consumers (useYDoc / useRemoteEditors / ReadOnlyGate).
// The provider imported those consumers while they imported the context back
// from the provider — a 3-file cycle fallow flagged. Holding the context object
// here lets consumers depend on a leaf module with no path back to the provider.
import { createContext } from 'react';

export const YDocContext = createContext(null);
