import { extractFriendCode, FRIEND_CODE_LENGTH } from '@sudoku-fight/protocol';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type NativeSyntheticEvent,
  StyleSheet,
  TextInput,
  type TextInputKeyPressEventData,
  View,
} from 'react-native';

import { Button } from '../../components/ui/Button';
import { Text } from '../../components/ui/Text';
import { color, radius, size, space, text, tokens } from '../../theme';
import { FieldMessage } from '../account/Field';
import { boxesOf, type CodeDigits, codeOf, digitsOf, typeInto } from './friendsModel';

export interface CodeInputProps {
  /** The six boxes, '' for an empty one (the screen keeps them: a refusal can clear them). */
  digits: CodeDigits;
  onChange: (digits: CodeDigits) => void;
  /** Every box has its digit: the code, once per change that completes it. */
  onComplete?: (code: string) => void;
  /**
   * "הדבק": the text on the clipboard (expo-clipboard on the phone), or null when there is none. Left out:
   * no button (a long press still pastes into a box).
   */
  readClipboard?: () => Promise<string | null>;
  /** The line under the boxes: why the last try failed. */
  error?: string | null;
  /** While joining: nothing can be typed. */
  disabled?: boolean;
  autoFocus?: boolean;
  testID?: string;
}

/**
 * "הקלד את 6 הספרות שקיבלת" (friends-room.md §3.3): six boxes with the number pad, always left to right (like
 * the board and the keypad, in Hebrew too), three and three. A digit moves on to the next box; backspace in an
 * empty box goes back and clears the one before. Text with more than one digit, typed or pasted into any box
 * (a whole WhatsApp message, "בוא לשחק איתי… קוד החדר: 123456 https://…"), is read with the protocol's
 * extractFriendCode: the code fills every box. "הדבק" does the same from the clipboard, for whoever does not
 * know the long press. Each box is its own field for a screen reader ("ספרה 3 מתוך 6"), so the digits are
 * heard one by one. Nothing here moves: no motion to reduce.
 */
export function CodeInput({
  digits,
  onChange,
  onComplete,
  readClipboard,
  error = null,
  disabled = false,
  autoFocus = false,
  testID = 'code-input',
}: CodeInputProps) {
  const { t } = useTranslation('friends');
  const inputs = useRef<(TextInput | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const [pasteMiss, setPasteMiss] = useState(false);

  const focus = (index: number) => inputs.current[index]?.focus();

  const set = (next: CodeDigits, focusAt: number | null) => {
    setPasteMiss(false);
    onChange(next);
    const code = codeOf(next);
    if (code !== null) {
      inputs.current[focusAt ?? FRIEND_CODE_LENGTH - 1]?.blur();
      onComplete?.(code);
    } else if (focusAt !== null) focus(focusAt);
  };

  const changeAt = (index: number, typed: string) => {
    // A whole code (or a message or a link with one): every box at once.
    const whole = typed.length > 1 ? extractFriendCode(typed) : null;
    if (whole !== null) {
      set(boxesOf(whole), null);
      return;
    }
    let fresh = digitsOf(typed);
    const old = digits[index] ?? '';
    // A digit typed beside the one the box had ("35" over "3"): the new one wins.
    if (old && fresh.length > 1 && fresh.includes(old)) fresh = fresh.replace(old, '');
    if (fresh === '') {
      const cleared = [...digits];
      cleared[index] = '';
      set(cleared, index);
      return;
    }
    const { boxes, focus: at } = typeInto(digits, index, fresh);
    set(boxes, at);
  };

  const keyAt = (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key !== 'Backspace' || digits[index] || index === 0) return;
    const back = [...digits];
    back[index - 1] = '';
    set(back, index - 1);
  };

  const paste = () => {
    if (!readClipboard) return;
    void readClipboard()
      .catch(() => null)
      .then((clip) => {
        const code = clip ? extractFriendCode(clip) : null;
        if (code === null) {
          setPasteMiss(true);
          return;
        }
        set(boxesOf(code), null);
      });
  };

  const shownError = pasteMiss ? t('join.pasteNone') : error;
  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.boxes} accessibilityLabel={t('join.codeLabel')} testID={`${testID}-boxes`}>
        {Array.from({ length: FRIEND_CODE_LENGTH }, (_, i) => (
          <TextInput
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            value={digits[i] ?? ''}
            onChangeText={(typed) => changeAt(i, typed)}
            onKeyPress={(e) => keyAt(i, e)}
            onFocus={() => setFocused(i)}
            onBlur={() => setFocused((f) => (f === i ? null : f))}
            editable={!disabled}
            autoFocus={autoFocus && i === 0}
            keyboardType="number-pad"
            inputMode="numeric"
            textContentType="oneTimeCode"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            selectTextOnFocus
            caretHidden
            accessibilityLabel={t('join.digitLabel', { n: i + 1, total: FRIEND_CODE_LENGTH })}
            accessibilityHint={i === 0 ? t('join.prompt') : undefined}
            style={[
              styles.box,
              i === HALF && styles.secondHalf,
              focused === i && styles.boxFocused,
              shownError ? styles.boxError : null,
              disabled && styles.disabled,
            ]}
            testID={`${testID}-${i}`}
          />
        ))}
      </View>
      <FieldMessage error={shownError} testID={testID} />
      {readClipboard ? (
        <View style={styles.pasteRow}>
          <Button
            label={t('join.paste')}
            onPress={paste}
            variant="secondary"
            size="modal"
            disabled={disabled}
            testID={`${testID}-paste`}
          />
          <Text style={styles.pasteHint}>{t('join.pasteHint')}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The first box of the second three: a wider gap before it ("123 456"). */
const HALF = FRIEND_CODE_LENGTH / 2;
/** A box: wide enough for a Teko digit, as high as a field. */
const BOX = { width: size.touch, height: size.buttonMd } as const;

const styles = StyleSheet.create({
  root: { gap: space[6] },
  // Always left to right, as the board and the keypad (CLAUDE.md): the first digit at the left in Hebrew too.
  boxes: { direction: 'ltr', flexDirection: 'row', justifyContent: 'center', gap: space[4] },
  box: {
    ...text('keyDigit'),
    ...BOX,
    padding: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    writingDirection: 'ltr',
    color: color.input.text,
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.input.border,
    backgroundColor: color.input.bg,
    includeFontPadding: false,
  },
  secondHalf: { marginStart: space[6] },
  boxFocused: { borderColor: color.input.borderFocus, borderWidth: tokens.border.focus },
  boxError: { borderColor: color.input.borderError },
  disabled: { opacity: tokens.opacity.disabled },
  pasteRow: { flexDirection: 'row', alignItems: 'center', gap: space[6] },
  pasteHint: { ...text('caption'), color: color.textMuted, flex: 1 },
});
