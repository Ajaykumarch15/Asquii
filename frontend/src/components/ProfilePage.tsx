/**
 * Signed-in profile page: read-only account summary plus the self-service
 * fields the backend allows (display name and job title, PATCH /auth/me).
 *
 * Email, user id, and roles are displayed but never editable here — they are
 * owned by Supabase Auth and the workspace role endpoints.
 */

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, IdCard, Loader2, Mail, RotateCcw, ShieldCheck } from "lucide-react";
import { Badge, Button, TextInput } from "./ui";
import { friendlyError } from "../lib/api/client";
import { profileApi } from "../lib/api/profile";
import type { AuthIdentity } from "../lib/auth/AuthContext";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "U";
}

export function ProfilePage({ identity, getAccessToken, onIdentityChange }: {
  identity: AuthIdentity;
  getAccessToken: () => Promise<string | null>;
  /** Push the saved profile back into the shared auth state (header initials, name). */
  onIdentityChange: (identity: AuthIdentity) => void;
}) {
  const [displayName, setDisplayName] = useState(identity.displayName);
  const [jobTitle, setJobTitle] = useState(identity.jobTitle ?? "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Keep the form aligned with the shared identity after a save or sign-in.
  useEffect(() => {
    setDisplayName(identity.displayName);
    setJobTitle(identity.jobTitle ?? "");
  }, [identity.userId, identity.displayName, identity.jobTitle]);

  // One-shot refresh so the read-only view is authoritative even if the name
  // changed on another device after sign-in. Cached identity remains usable
  // when this read fails (the form still saves through the same token).
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const profile = await profileApi.getProfile(token);
        if (disposed) return;
        if (profile.display_name !== identity.displayName || profile.job_title !== identity.jobTitle) {
          onIdentityChange({
            userId: profile.user_id,
            email: profile.email,
            displayName: profile.display_name,
            jobTitle: profile.job_title,
          });
        }
      } catch {
        // Non-blocking: the identity verified at sign-in is still shown.
      }
    })();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per signed-in user
  }, [identity.userId, getAccessToken, onIdentityChange]);

  const trimmedName = displayName.trim();
  const trimmedTitle = jobTitle.trim();
  const dirty = trimmedName !== identity.displayName || trimmedTitle !== (identity.jobTitle ?? "");
  const canSave = dirty && trimmedName.length > 0 && !saving;

  const reset = () => {
    setDisplayName(identity.displayName);
    setJobTitle(identity.jobTitle ?? "");
    setNotice(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmedName) {
      setNotice({ tone: "error", text: "Display name cannot be blank." });
      return;
    }
    const changes: { display_name?: string; job_title?: string | null } = {};
    if (trimmedName !== identity.displayName) changes.display_name = trimmedName;
    const nextTitle = trimmedTitle || null;
    if (nextTitle !== (identity.jobTitle ?? null)) changes.job_title = nextTitle;
    if (Object.keys(changes).length === 0) return;

    setSaving(true);
    setNotice(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setNotice({ tone: "error", text: "Sign-in session ended. Please sign in again." });
        return;
      }
      const updated = await profileApi.updateProfile(token, changes);
      onIdentityChange({
        userId: updated.user_id,
        email: updated.email,
        displayName: updated.display_name,
        jobTitle: updated.job_title,
      });
      setNotice({ tone: "success", text: "Profile updated." });
    } catch (error) {
      const friendly = friendlyError(error, "Could not update your profile");
      setNotice({ tone: "error", text: `${friendly.title}: ${friendly.message}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1.5 text-sm text-muted">Your account details across every workspace.</p>
      </div>

      {notice && (
        <div role="status" className={`rounded-xl border border-line px-4 py-3 text-xs font-medium ${notice.tone === "success" ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>
          {notice.text}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-4 border-b border-line p-5">
            <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand text-base font-semibold text-white">
              {initials(identity.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold text-heading">{identity.displayName}</h2>
                <Badge tone="success">Signed in</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">{identity.jobTitle || "No job title yet"}</p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4 p-5">
            <div className="border-b border-line pb-3">
              <h3 className="text-sm font-semibold text-heading">Profile details</h3>
              <p className="mt-1 text-xs text-muted">This is how you appear in workspace member lists.</p>
            </div>
            <TextInput
              label="Display name"
              required
              maxLength={120}
              value={displayName}
              onChange={event => { setDisplayName(event.target.value); setNotice(null); }}
              hint="Shown to teammates in member lists, task assignees, and activity feeds."
            />
            <TextInput
              label="Job title"
              maxLength={120}
              value={jobTitle}
              onChange={event => { setJobTitle(event.target.value); setNotice(null); }}
              placeholder="e.g. Product designer"
              hint="Optional. Used to group people by team in the workspace overview."
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button type="submit" variant="primary" disabled={!canSave} icon={saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" disabled={!dirty || saving} icon={<RotateCcw size={14} />} onClick={reset}>
                Reset
              </Button>
            </div>
          </form>
        </section>

        <section className="space-y-3">
          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <ShieldCheck size={15} className="text-brand" />
              <h2 className="text-sm font-semibold text-heading">Account</h2>
            </div>
            <dl className="mt-4 space-y-4">
              <div>
                <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted"><Mail size={12} />Email</dt>
                <dd className="mt-1 break-all text-xs font-medium text-heading">{identity.email ?? "No email on this account"}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted"><IdCard size={12} />Account ID</dt>
                <dd className="mt-1 break-all font-mono text-[10px] text-secondary">{identity.userId}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted">Sign-in</dt>
                <dd className="mt-1 text-xs font-medium text-heading">Supabase Auth · email &amp; password</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[11px] leading-5 text-muted">
              Your email and password are managed by your sign-in provider. Workspace roles are managed by your workspace Owner from the People page.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
