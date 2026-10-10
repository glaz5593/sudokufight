// The screen's own file, not the home barrel: the barrel would load Settings, Modes and the rest before the
// first screen (spec §22: open in under 2 s; src/__tests__/startupGraph.test.ts).
import { HomeScreen } from '../src/screens/home/HomeScreen';

/** / : Home (spec §4.3). The links to the dev screens show in development builds only. */
export default function Index() {
  return <HomeScreen devLinks={__DEV__} />;
}
