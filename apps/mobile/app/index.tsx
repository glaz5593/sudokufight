import { HomeScreen } from '../src/screens/home';

/** / : Home (spec §4.3). The links to the dev screens show in development builds only. */
export default function Index() {
  return <HomeScreen devLinks={__DEV__} />;
}
