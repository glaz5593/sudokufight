import { NavigationContext } from 'expo-router/react-navigation';
import { useCallback, useContext, useSyncExternalStore } from 'react';

/**
 * Whether the screen this is drawn on is the one shown: false while another screen covers it (Home under the
 * game stays mounted in the stack). Outside a navigator (a test, a view on its own) it is always true.
 *
 * expo-router's useIsFocused throws outside a navigator; this reads the screen's navigation object if there is
 * one, as useIsFocused does.
 */
export function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation) return () => {};
      const offFocus = navigation.addListener('focus', onChange);
      const offBlur = navigation.addListener('blur', onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation],
  );
  const focused = useCallback(() => navigation?.isFocused() ?? true, [navigation]);
  return useSyncExternalStore(subscribe, focused, focused);
}
