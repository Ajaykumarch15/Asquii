/**
 * Signed-in account settings: read-only account summary, appearance,
 * browser-local notification preferences, and Supabase Auth security flows.
 *
 * Display name / job title stay on the Profile page; this page only delegates
 * password and email changes to Supabase Auth, so no secret ever reaches the
 * Asquii backend.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Bell, CheckCircle2, KeyRound, Loader2, Mail, Moon, Palette, ShieldCheck, Sun, UserRound } from "lucide-react";
import { Badge, Button, TextInput } from "./ui";
import type { AuthIdentity } from "../lib/auth/AuthContext";

type NotificationPrefs = {
  taskAssignments: boolean;
  projectUpdates: boolean;
  upcomingDeadlines: boolean;
};

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  taskAssignments: true,
  projectUpdates: true,
  upcomingDeadlines: true,
};

const NOTIFICATION_ITEMS = [
  { key: "taskAssignments", title: "Task assignments", description: "Tasks assigned to you that are overdue or due soon." },
  { key: "projectUpdates", title: "Project updates", description: "New or updated resources in your projects." },
  { key: "upcomingDeadlines", title: "Upcoming deadlines", description: "Meetings this week and milestones at risk." },
] as const;

const SECTIONS = ["Account", "Appearance", "Notifications", "Security"] as const;
type Section = (typeof SECTIONS)[number];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function prefsKey(userId: string) {
  return `asquii.notification-prefs.${userId}`;
}

function readNotificationPrefs(userId: string): NotificationPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(userId));
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_NOTIFICATION_PREFS;
    const record = parsed as Record<string, unknown>;
    return {
      taskAssignments: typeof record.taskAssignments === "boolean" ? record.taskAssignments : true,
      projectUpdates: typeof record.projectUpdates === "boolean" ? record.projectUpdates : true,
      upcomingDeadlines: typeof record.upcomingDeadlines === "boolean" ? record.upcomingDeadlines : true,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

function writeNotificationPrefs(userId: string, prefs: NotificationPrefs) {
  try {
    localStorage.setItem(prefsKey(userId), JSON.stringify(prefs));
  } catch {
    // Private mode or quota: the toggles still apply for this session.
  }
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "U";
}

type Notice = { tone: "success" | "error"; text: string } | null;

export function AccountSettingsPage({ identity, theme, onToggleTheme, onOpenProfile, onChangePassword, onChangeEmail }: {
  identity: AuthIdentity;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  /** Display name and job title live on the profile page. */
  onOpenProfile: () => void;
  onChangePassword: (password: string) => Promise<{ ok: boolean; error?: string }>;
  onChangeEmail: (email: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [section, setSection] = useState<Section>("Account");

  // Notifications are per-account but browser-local: there is no delivery
  // backend yet, so the preference is honest about where it is stored.
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => readNotificationPrefs(identity.userId));
  useEffect(() => {
    setPrefs(readNotificationPrefs(identity.userId));
  }, [identity.userId]);
  const togglePref = (key: keyof NotificationPrefs) => {
    setPrefs(previous => {
      const next = { ...previous, [key]: !previous[key] };
      writeNotificationPrefs(identity.userId, next);
      return next;
    });
  };

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);

  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNotice, setEmailNotice] = useState<Notice>(null);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setPasswordNotice(null);
    if (password.length < 8) {
      setPasswordNotice({ tone: "error", text: "Use at least 8 characters for the new password." });
      return;
    }
    if (password !== confirmPassword) {
      setPasswordNotice({ tone: "error", text: "The two passwords do not match." });
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await onChangePassword(password);
      if (!result.ok) {
        setPasswordNotice({ tone: "error", text: result.error ?? "Could not update the password." });
        return;
      }
      setPassword("");
      setConfirmPassword("");
      setPasswordNotice({ tone: "success", text: "Password updated. Use it the next time you sign in." });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setEmailNotice(null);
    const nextEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(nextEmail)) {
      setEmailNotice({ tone: "error", text: "Enter a valid email address." });
      return;
    }
    if (nextEmail === identity.email?.toLowerCase()) {
      setEmailNotice({ tone: "error", text: "That is already your account email." });
      return;
    }
    setEmailBusy(true);
    try {
      const result = await onChangeEmail(nextEmail);
      if (!result.ok) {
        setEmailNotice({ tone: "error", text: result.error ?? "Could not request the email change." });
        return;
      }
      setEmail("");
      setEmailNotice({
        tone: "success",
        text: `Confirmation sent to ${nextEmail}. Your current email stays active until the change is confirmed.`,
      });
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
          <p className="mt-1.5 text-sm text-muted">Appearance, notifications, and sign-in security.</p>
        </div>
        <nav aria-label="Account settings sections" className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-2 lg:flex-col">
          {SECTIONS.map(item => (
            <button
              key={item}
              type="button"
              aria-current={section === item ? "page" : undefined}
              className={`shrink-0 rounded-lg px-3 py-2.5 text-left text-xs font-medium ${section === item ? "bg-brand-soft text-brand-pressed" : "text-secondary hover:bg-hover"}`}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      </div>

      <section className="min-h-[440px] rounded-xl border border-line bg-surface p-4 sm:p-6">
        {section === "Account" && (
          <div className="max-w-2xl">
            <div className="border-b border-line pb-4">
              <h2 className="text-base font-semibold">Account</h2>
              <p className="mt-1.5 text-xs text-muted">Your verified sign-in identity. These details are read-only here.</p>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">{initials(identity.displayName)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-heading">{identity.displayName}</p>
                  <Badge tone="success">Signed in</Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">{identity.jobTitle || "No job title yet"}</p>
              </div>
              <Button size="sm" variant="secondary" icon={<UserRound size={14} />} onClick={onOpenProfile}>Edit profile details</Button>
            </div>
            <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <div>
                <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted"><Mail size={12} />Email</dt>
                <dd className="mt-1 break-all text-xs font-medium text-heading">{identity.email ?? "No email on this account"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted">Account ID</dt>
                <dd className="mt-1 break-all font-mono text-[10px] text-secondary">{identity.userId}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted">Sign-in</dt>
                <dd className="mt-1 text-xs font-medium text-heading">Supabase Auth · email &amp; password</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-muted">Workspace role</dt>
                <dd className="mt-1 text-xs font-medium text-heading">Managed by each workspace Owner</dd>
              </div>
            </dl>
          </div>
        )}

        {section === "Appearance" && (
          <div className="max-w-2xl">
            <div className="border-b border-line pb-4">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Palette size={16} className="text-brand" />Appearance</h2>
              <p className="mt-1.5 text-xs text-muted">Choose how Asquii looks on this device.</p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {(["light", "dark"] as const).map(preview => (
                <button
                  key={preview}
                  type="button"
                  className={`rounded-xl border p-3 text-left transition ${theme === preview ? "border-brand" : "border-line hover:border-strong"}`}
                  aria-pressed={theme === preview}
                  onClick={() => { if (preview !== theme) onToggleTheme(); }}
                >
                  <span className={`mb-3 flex h-16 items-start gap-2 rounded-lg border p-2.5 ${preview === "light" ? "border-[#E5E7ED] bg-[#F7F8FA]" : "border-[#34343F] bg-[#14141A]"}`}>
                    <span className={`h-2.5 w-2.5 rounded-full ${preview === "light" ? "bg-[#6855C5]" : "bg-[#A99AEF]"}`} />
                    <span className="flex-1 space-y-1.5 pt-1">
                      <span className={`block h-1.5 w-3/4 rounded-full ${preview === "light" ? "bg-[#D3D6E0]" : "bg-[#484854]"}`} />
                      <span className={`block h-1.5 w-1/2 rounded-full ${preview === "light" ? "bg-[#E5E7ED]" : "bg-[#34343F]"}`} />
                      <span className={`block h-1.5 w-2/3 rounded-full ${preview === "light" ? "bg-[#E5E7ED]" : "bg-[#34343F]"}`} />
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold">{preview === "light" ? <Sun size={13} /> : <Moon size={13} />}{preview === "light" ? "Light" : "Dark"}</span>
                  <span className="mt-1 block text-[11px] text-muted">{theme === preview ? "Currently active" : `Switch to ${preview} mode`}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">The theme is saved in this browser and applies immediately across the app.</p>
          </div>
        )}

        {section === "Notifications" && (
          <div className="max-w-2xl">
            <div className="border-b border-line pb-4">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Bell size={16} className="text-brand" />Notifications</h2>
              <p className="mt-1.5 text-xs text-muted">Choose which workspace updates you want to hear about.</p>
            </div>
            <div className="mt-4 space-y-3">
              {NOTIFICATION_ITEMS.map(item => (
                <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brand"
                    checked={prefs[item.key]}
                    onChange={() => togglePref(item.key)}
                  />
                  <span>
                    <span className="block text-xs font-semibold">{item.title}</span>
                    <span className="mt-1 block text-[11px] text-muted">{item.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
              <CheckCircle2 size={12} className="text-success" />
              Saved automatically in this browser for this account. Email delivery is not connected to a backend yet.
            </p>
          </div>
        )}

        {section === "Security" && (
          <div className="max-w-2xl">
            <div className="border-b border-line pb-4">
              <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck size={16} className="text-brand" />Security</h2>
              <p className="mt-1.5 text-xs text-muted">Password and email changes are handled directly by Supabase Auth — the Asquii API never receives them.</p>
            </div>

            <form onSubmit={submitPassword} className="mt-5 space-y-3">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-heading"><KeyRound size={13} />Change password</h3>
              <TextInput
                label="New password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={event => { setPassword(event.target.value); setPasswordNotice(null); }}
                hint="At least 8 characters."
              />
              <TextInput
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => { setConfirmPassword(event.target.value); setPasswordNotice(null); }}
              />
              {passwordNotice && (
                <p role="status" className={`text-xs font-medium ${passwordNotice.tone === "success" ? "text-success" : "text-danger"}`}>{passwordNotice.text}</p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={passwordBusy || password.length === 0 || confirmPassword.length === 0}
                icon={passwordBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              >
                {passwordBusy ? "Updating…" : "Update password"}
              </Button>
            </form>

            <form onSubmit={submitEmail} className="mt-6 space-y-3 border-t border-line pt-5">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-heading"><Mail size={13} />Change email</h3>
              <TextInput
                label="New email address"
                type="email"
                autoComplete="email"
                placeholder={identity.email ?? "you@example.com"}
                value={email}
                onChange={event => { setEmail(event.target.value); setEmailNotice(null); }}
                hint="You will receive a confirmation link. Your current email stays active until then."
              />
              {emailNotice && (
                <p role="status" className={`text-xs font-medium ${emailNotice.tone === "success" ? "text-success" : "text-danger"}`}>{emailNotice.text}</p>
              )}
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={emailBusy || email.trim().length === 0}
                icon={emailBusy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              >
                {emailBusy ? "Sending…" : "Send confirmation"}
              </Button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
