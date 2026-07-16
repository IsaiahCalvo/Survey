import 'react-native-gesture-handler'; // must be first — required by RNGH
import { registerRootComponent } from 'expo';

import DevRoot from './DevRoot';

// DevRoot wraps the real App with the throwaway Gesture Sandbox (🧪 button).
// To ship without the sandbox, change this back to `import App from './App'`.
// registerRootComponent calls AppRegistry.registerComponent('main', () => DevRoot);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(DevRoot);
