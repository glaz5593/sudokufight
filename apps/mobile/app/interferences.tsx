import { useMyLevel } from '../src/progress/hooks';
import { goBack } from '../src/screens/home';
import { InterferencesScreen } from '../src/screens/progress';

/** /interferences: the interferences collection (spec §7.1), from the progress tab. */
export default function InterferencesRoute() {
  const level = useMyLevel();
  return <InterferencesScreen level={level} onBack={goBack} />;
}
