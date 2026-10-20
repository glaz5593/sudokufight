import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateView } from '../src/components/ui';
import { color, tokens } from '../src/theme';

/** Home, with nothing behind it: the unknown link left no screen worth going back to. */
const goHome = () => {
  if (router.canDismiss()) router.dismissAll();
  router.replace('/');
};

/**
 * A link the app does not know (1.0.4, friends-room.md §6.8): an old one, one of a later version, or not ours.
 * expo-router's own "not found" screen was a dead end; this one says so and leads home ("למסך הבית", and
 * Android's back). A room link never lands here: app/+native-intent.tsx sends a good one into its room and a
 * bad one home. Static: no animation.
 */
export default function NotFoundRoute() {
  const { t } = useTranslation('friends');

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goHome();
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={styles.screen} testID="not-found">
      <View style={styles.body}>
        <StateView
          icon="links"
          title={t('link.notFound.title')}
          body={t('link.notFound.body')}
          actions={[
            {
              label: t('link.notFound.home'),
              icon: 'home',
              variant: 'primary',
              onPress: goHome,
              testID: 'not-found-home',
            },
          ]}
          announce
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: tokens.layout.gutterHome },
});
