import { useEffect, useState, type InputHTMLAttributes, type Ref } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onCommit: (v: string) => void;
  delay?: number;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Text input that edits locally and commits to its owner after a pause, on Enter, and on blur. If the owner's value changes for
 * any other reason (back button, "clear all"), the text follows it, but never overwrites what the user is still typing.
 */
export function DebouncedInput({ value, onCommit, delay = 300, inputRef, onBlur, onKeyDown, ...rest }: Props) {
  const [text, setText] = useState(value);
  const [committed, setCommitted] = useState(value);
  const [seen, setSeen] = useState(value);

  // Derived-state sync during render (the React-recommended pattern; avoids an effect round trip).
  if (value !== seen) {
    setSeen(value);
    if (value !== committed) {
      setText(value);
      setCommitted(value);
    }
  }

  const commit = (v: string) => {
    const next = v.trim();
    if (next === committed) return;
    setCommitted(next);
    onCommit(next);
  };

  useEffect(() => {
    if (text.trim() === committed) return;
    const t = setTimeout(() => commit(text), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, committed, delay]);

  return (
    <input
      {...rest}
      ref={inputRef}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => { commit(text); onBlur?.(e); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(text); onKeyDown?.(e); }}
    />
  );
}
