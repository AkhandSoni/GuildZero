import type { ComponentProps } from "react";
import { Input } from "./input";
type Props = Omit<ComponentProps<"input">, "type" | "id"> & {
  id: string;
  label: string;
  visible: boolean;
  onToggle: () => void;
};
export function PasswordInput({ id, label, visible, onToggle, ...props }: Props) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="relative">
      <Input {...props} id={id} type={visible ? "text" : "password"}
        className="pr-20" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      <button type="button" className="password-toggle"
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-controls={id} aria-pressed={visible} onClick={onToggle}>
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  </div>;
}
