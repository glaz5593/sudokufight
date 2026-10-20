import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { FRIENDS_UI, type FriendsUiSettings } from '../../config/friends';
import { cue } from '../../services/feedback';
import { color, space, text, tokens } from '../../theme';
import { ScreenHeader } from '../home/parts';
import { CodeInput } from './CodeInput';
import {
  boxesOf,
  type CodeDigits,
  codeOf,
  EMPTY_CODE,
  failureText,
  type FriendsFailure,
} from './friendsModel';

/** How a join ended: in (the route moves on to the room), or why not. */
export type JoinOutcome =
  { ok: true } | { ok: false; failure: FriendsFailure; retryAfterSec?: number | null };

export interface JoinCodeScreenProps {
  /** POST /v1/rooms/join and into the room (net/friends.ts): how it went. */
  onJoin: (code: string) => Promise<JoinOutcome>;
  /** The clipboard's text, for "הדבק" (expo-clipboard on the phone); left out, no button. */
  readClipboard?: () => Promise<string | null>;
  onBack: () => void;
  /** A code to start from (a link's, or the last one tried). */
  initialCode?: string | null;
  settings?: Pick<FriendsUiSettings, 'autoJoin'>;
}

/**
 * "הצטרף עם קוד" (friends-room.md §3.3): "הקלד את 6 הספרות שקיבלת", six boxes always left to right, and
 * "הדבק" for a whole WhatsApp message. Once the sixth digit is in, the join starts by itself
 * (FRIENDS_UI.autoJoin; "הצטרף" does it too, and again after a refusal). A refusal is said under the boxes, in
 * the words of §3.6: "לא מצאנו חדר עם הקוד 123 456. בדוק את הספרות." (a block reads exactly the same, D85c).
 */
export function JoinCodeScreen({
  onJoin,
  readClipboard,
  onBack,
  initialCode = null,
  settings = FRIENDS_UI,
}: JoinCodeScreenProps) {
  const { t } = useTranslation('friends');
  const { top, bottom } = useSafeAreaInsets();
  const [digits, setDigits] = useState<CodeDigits>(() => (initialCode ? boxesOf(initialCode) : EMPTY_CODE));
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const join = (code: string) => {
    if (busy.current) return;
    busy.current = true;
    setJoining(true);
    setError(null);
    cue('primaryPress');
    void onJoin(code)
      .catch((): JoinOutcome => ({ ok: false, failure: 'internal' }))
      .then((outcome) => {
        busy.current = false;
        setJoining(false);
        if (!outcome.ok) {
          cue('formError');
          setError(failureText(t, outcome.failure, { code, retryAfterSec: outcome.retryAfterSec }));
        }
      });
  };

  const code = codeOf(digits);
  return (
    <View style={[styles.screen, { paddingTop: top }]} testID="friends-join">
      <ScreenHeader title={t('join.title')} onBack={onBack} style={styles.header} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottom + space[9] }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.prompt}>{t('join.prompt')}</Text>
        <CodeInput
          digits={digits}
          onChange={(next) => {
            setDigits(next);
            if (error) setError(null);
          }}
          onComplete={settings.autoJoin ? join : undefined}
          readClipboard={readClipboard}
          error={error}
          disabled={joining}
          autoFocus={!initialCode}
          testID="friends-code-input"
        />
        <View style={styles.actions}>
          <Button
            label={joining ? t('join.joining') : t('join.submit')}
            onPress={code ? () => join(code) : undefined}
            disabled={code === null}
            loading={joining}
            testID="friends-join-submit"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: tokens.layout.gutterGame },
  content: { paddingHorizontal: tokens.layout.gutterGame, paddingTop: space[8], gap: space[9] },
  prompt: { ...text('rowTitle'), color: color.text, textAlign: 'center' },
  actions: { gap: space[4] },
});
