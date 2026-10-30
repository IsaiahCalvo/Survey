// The app's one store of the signed-in account's own Excel layouts (Nightly
// beta 'own-excel-layouts'); see ownKits.js.
import { supabase } from '../../supabaseClient';
import { createOwnKitStore } from './ownKits.js';

export const ownKitStore = createOwnKitStore(supabase);
