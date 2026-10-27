import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SOUND_CANDIDATES } from '../components/dev/soundCandidates';
import { ltr } from '../components/player';
import { Button, IconButton } from '../components/ui';
import { Text } from '../components/ui/Text';
import { CUES, FEEDBACK_CUES } from '../services/feedback';
import { haptics, type HapticPattern } from '../services/haptics';
import { GAME_AUDIO_MODE, SOUND_IDS, SOUND_SOURCES, volumeOf, type SoundId } from '../services/sfx';
import { color, radius, space, text, tokens } from '../theme';

/** The audition's audio mode: it plays on silent too, so only the device volume counts. */
const AUDITION_AUDIO_MODE = { playsInSilentMode: true, interruptionMode: 'mixWithOthers' } as const;

function report(error: unknown): void {
  if (__DEV__) console.warn('[sounds]', error);
}

function setMode(mode: typeof AUDITION_AUDIO_MODE | typeof GAME_AUDIO_MODE): void {
  try {
    setAudioModeAsync(mode).catch(report);
  } catch (error) {
    report(error);
  }
}

/** The haptic a sound comes with in the game: that of the first cue that plays it (feedback.ts). */
export function hapticOf(id: SoundId): HapticPattern | null {
  for (const name of FEEDBACK_CUES) {
    const { sound, haptic } = CUES[name];
    if (sound === id && haptic) return haptic;
  }
  return null;
}

export interface SoundAuditionScreenProps {
  onClose?: () => void;
  testID?: string;
}

/**
 * /dev/sounds (development builds; work plan "צלילים סופיים וכיול עוצמות"): every sound of motion.md §8, with
 * what the app plays now, the CC0 candidate (assets/sounds/candidates) and the haptic it comes with.
 *
 * It plays through its own players, not the sfx service: the "צליל" setting and the silent switch don't apply
 * here, only the device volume. Sounds play at their game volume (sfx.ts), or at 1.0 with the switch on, which
 * is what calibrating the volumes needs. The haptic goes through the haptics service, so "רטט" applies.
 */
export function SoundAuditionScreen({ onClose, testID = 'dev-sounds-screen' }: SoundAuditionScreenProps) {
  const { t } = useTranslation('dev');
  const insets = useSafeAreaInsets();
  const [fullVolume, setFullVolume] = useState(false);
  const players = useRef(new Map<string, AudioPlayer>());

  useEffect(() => {
    setMode(AUDITION_AUDIO_MODE);
    const open = players.current;
    return () => {
      for (const player of open.values()) {
        try {
          player.remove();
        } catch (error) {
          report(error);
        }
      }
      open.clear();
      setMode(GAME_AUDIO_MODE);
    };
  }, []);

  const play = useCallback((key: string, source: number, volume: number) => {
    try {
      let player = players.current.get(key);
      if (!player) {
        player = createAudioPlayer(source);
        players.current.set(key, player);
      }
      player.volume = volume;
      player.seekTo(0).catch(report);
      player.play();
    } catch (error) {
      report(error);
    }
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID={testID}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[12] }]}>
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.title} accessibilityRole="header">
              {t('sounds.title')}
            </Text>
            <Text style={styles.muted}>{t('sounds.subtitle')}</Text>
          </View>
          {onClose ? (
            <IconButton
              icon="close"
              iconSize="header"
              accessibilityLabel={t('sounds.close')}
              onPress={onClose}
              testID="dev-sounds-close"
            />
          ) : null}
        </View>
        <Text style={styles.muted}>{t('sounds.intro')}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchText}>{t('sounds.fullVolume')}</Text>
          <Switch
            value={fullVolume}
            onValueChange={setFullVolume}
            accessibilityLabel={t('sounds.fullVolume')}
            trackColor={TRACK}
            thumbColor={color.text}
            testID="dev-sounds-full-volume"
          />
        </View>
        {SOUND_IDS.map((id) => {
          const cue = t(`sounds.cues.${id}`);
          const volume = fullVolume ? 1 : volumeOf(id);
          const candidate = SOUND_CANDIDATES[id];
          const haptic = hapticOf(id);
          const pattern = haptic ? t(`sounds.patterns.${haptic}`) : '';
          return (
            <View key={id} style={styles.row} testID={`dev-sound-${id}`}>
              <Text style={styles.cue}>{cue}</Text>
              <Text style={styles.meta}>
                {t('sounds.volume', { id: ltr(id), volume: volume.toFixed(1) })}
              </Text>
              <Text style={styles.meta} testID={`dev-sound-${id}-origin`}>
                {candidate
                  ? t('sounds.origin', {
                      origin: ltr(candidate.origin),
                      file: ltr(candidate.file),
                      ms: candidate.ms,
                    })
                  : t('sounds.noCandidate')}
              </Text>
              <View style={styles.buttons}>
                <Button
                  label={t('sounds.current')}
                  accessibilityLabel={t('sounds.currentLabel', { cue })}
                  variant="secondary"
                  size="modal"
                  onPress={() => play(`current:${id}`, SOUND_SOURCES[id], volume)}
                  testID={`dev-sound-${id}-current`}
                />
                <Button
                  label={t('sounds.candidate')}
                  accessibilityLabel={t('sounds.candidateLabel', { cue })}
                  variant="secondary"
                  size="modal"
                  selected
                  disabled={!candidate}
                  onPress={() => candidate && play(`candidate:${id}`, candidate.source, volume)}
                  testID={`dev-sound-${id}-candidate`}
                />
                <Button
                  label={haptic ? t('sounds.haptic', { pattern }) : t('sounds.noHaptic')}
                  accessibilityLabel={haptic ? t('sounds.hapticLabel', { pattern, cue }) : undefined}
                  variant="ghost"
                  disabled={!haptic}
                  onPress={() => haptic && haptics.fire(haptic)}
                  testID={`dev-sound-${id}-haptic`}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const TRACK = { false: color.border, true: color.accent } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: tokens.layout.gutterHome, gap: space[8] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  heading: { flexShrink: 1, gap: space[2] },
  title: { ...text('screenTitle'), color: color.text },
  muted: { ...text('body'), color: color.textMuted },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  switchText: { ...text('label'), color: color.text, flexShrink: 1 },
  row: {
    backgroundColor: color.surface,
    borderColor: color.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space[8],
    gap: space[3],
  },
  cue: { ...text('rowTitle'), color: color.text },
  meta: { ...text('caption'), color: color.textMuted },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[4],
    marginTop: space[3],
  },
});
