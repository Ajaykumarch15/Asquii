import { useState } from "react";
import { X } from "lucide-react";
import { Button, Select, TextInput } from "../../../components/ui";
import type { Workspace } from "../../../model";

export function WorkspaceEditor({ onClose, onSave }: { onClose: () => void; onSave: (workspace: Omit<Workspace, "id">) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [visibility, setVisibility] = useState<Workspace["visibility"]>("private");
  return <Modal title="Create workspace" onClose={onClose} onSubmit={event => { event.preventDefault(); const normalizedName = name.trim(); onSave({ name: normalizedName, url: url.trim() || normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), visibility, notifications: { taskAssignments: true, projectUpdates: true, upcomingDeadlines: true } }); }} submitLabel="Create workspace"><p className="text-xs text-muted">Create a separate home for projects, people, and settings. You’ll be its admin.</p><TextInput autoFocus label="Workspace name" value={name} onChange={event => { setName(event.target.value); setUrl(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-")); }} required /><TextInput label="Workspace URL" value={url} onChange={event => setUrl(event.target.value)} required /><Select label="Default visibility" value={visibility} onChange={event => setVisibility(event.target.value as Workspace["visibility"])}><option value="private">Private to invited members</option><option value="link">Anyone with the link</option></Select></Modal>;
}


function Modal({ title, onClose, onSubmit, submitLabel, children }: { title: string; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; submitLabel: string; children: React.ReactNode }) {
  return <div className="ui-modal-backdrop fixed inset-0 z-[60] grid place-items-center p-3 sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><form role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => { if (event.key === "Escape") onClose(); }} onSubmit={onSubmit} className="max-h-[92dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-2xl sm:p-5"><div className="flex items-center justify-between"><h2 className="text-base font-semibold">{title}</h2><button type="button" className="icon-button text-muted hover:text-heading" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>{children}<div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">{submitLabel}</Button></div></form></div>;
}
