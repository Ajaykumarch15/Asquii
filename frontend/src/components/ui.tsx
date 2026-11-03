import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: ReactNode };

export function Button({ variant = "secondary", size = "md", icon, className = "", children, ...props }: ButtonProps) {
  return <button className={`ui-button ui-button-${variant} ui-button-${size} ${className}`} {...props}>{icon}{children}</button>;
}

type FieldProps = { label?: string; hint?: string; error?: string; className?: string };
export function TextInput({ label, hint, error, className = "", icon, ...props }: InputHTMLAttributes<HTMLInputElement> & FieldProps & { icon?: ReactNode }) {
  return <Field label={label} hint={hint} error={error} className={className}><span className="relative block">{icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{icon}</span>}<input className={`ui-input ${icon ? "pl-9" : ""}`} {...props} /></span></Field>;
}
export function Select({ label, hint, error, className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & FieldProps) {
  return <Field label={label} hint={hint} error={error} className={className}><select className="ui-input" {...props}>{children}</select></Field>;
}
export function Textarea({ label, hint, error, className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  return <Field label={label} hint={hint} error={error} className={className}><textarea className="ui-input min-h-20 resize-y" {...props} /></Field>;
}
function Field({ label, hint, error, className = "", children }: FieldProps & { children: ReactNode }) {
  return <label className={`block space-y-1.5 ${className}`}>{label && <span className="ui-label">{label}</span>}{children}{error ? <span className="block text-xs text-danger">{error}</span> : hint && <span className="block text-xs text-muted">{hint}</span>}</label>;
}

const badgeColors = { neutral: "neutral", brand: "brand", success: "success", warning: "warning", danger: "danger" } as const;
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeColors; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${badgeColors[tone]}`}>{children}</span>;
}

export function Avatar({ name, color = "violet", size = "md" }: { name: string; color?: "violet" | "blue" | "green" | "orange"; size?: "sm" | "md" | "lg" }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return <span aria-label={name} title={name} className={`ui-avatar ui-avatar-${size} ui-avatar-${color}`}>{initials}</span>;
}

export function AvatarGroup({ names }: { names: string[] }) {
  return <div className="flex items-center -space-x-2">{names.slice(0, 4).map((name, index) => <Avatar key={name} name={name} size="sm" color={(["violet", "blue", "green", "orange"] as const)[index]} />)}{names.length > 4 && <span className="ui-avatar ui-avatar-sm ui-avatar-more">+{names.length - 4}</span>}</div>;
}

export function Tabs({ items, active, onChange }: { items: string[]; active: string; onChange: (item: string) => void }) {
  return <div className="ui-tabs" role="tablist">{items.map(item => <button key={item} role="tab" aria-selected={active === item} className={`ui-tab ${active === item ? "ui-tab-active" : ""}`} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="ui-state"><div className="ui-state-mark">✦</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function LoadingState({ label = "Loading content" }: { label?: string }) {
  return <div role="status" aria-label={label} aria-busy="true" className="space-y-3 rounded-lg border border-line bg-surface p-4 sm:p-5"><span className="sr-only">{label}</span><div className="ui-skeleton h-4 w-1/3" /><div className="ui-skeleton h-10 w-full" /><div className="ui-skeleton h-10 w-full" /><div className="ui-skeleton h-10 w-4/5" /></div>;
}

export function ErrorState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div role="alert" className="rounded-lg border border-line bg-surface"><div className="ui-state"><div className="ui-state-mark text-danger" style={{ background: "var(--danger-soft)" }}>!</div><h3>{title}</h3><p>{description}</p>{action}</div></div>;
}

export function StateMessage({ kind, title, children }: { kind: "loading" | "error" | "success"; title: string; children: ReactNode }) {
  return <div className={`ui-message ui-message-${kind}`}><strong>{title}</strong><span>{children}</span></div>;
}
