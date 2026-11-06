/**
 * Anonymous landing page (signed-out default route).
 *
 * The prototype demo is no longer the anonymous homepage: visitors land here
 * and explicitly opt into sample data ("Explore the demo") or sign in /
 * create an account through the existing AuthPanel modal. Real workspace data
 * is never touched from this page.
 */

import {
  ArrowRight,
  CalendarDays,
  FolderKanban,
  ListTodo,
  LogIn,
  Moon,
  ShieldCheck,
  Sun,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { Badge, Button } from "./ui";

const features = [
  {
    icon: <FolderKanban size={18} />,
    title: "Projects & milestones",
    body: "Statuses, progress and milestone dates per workspace — created by Owners and Admins, managed by Project Managers.",
  },
  {
    icon: <ListTodo size={18} />,
    title: "Tasks & subtasks",
    body: "Priorities, assignees, due dates, comments and ordered subtasks. Collaborators move work; managers remove it.",
  },
  {
    icon: <CalendarDays size={18} />,
    title: "Meetings & attendees",
    body: "Schedule, edit and delete meetings, keep an agenda, and manage the attendee list from active project members.",
  },
  {
    icon: <Users size={18} />,
    title: "People & roles",
    body: "Owner, Admin and Member workspace roles, project manager transfer, and token-based invitations that validate the invitee's email.",
  },
];

const steps = [
  { title: "Create a workspace", body: "The Owner names it; the slug is fixed at creation and stays stable." },
  { title: "Add projects and tasks", body: "Owners/Admins create projects; everyone with a project role collaborates." },
  { title: "Invite your team", body: "Create an invitation, share the token link, and the invitee joins at the invited role." },
  { title: "Follow the activity", body: "Every action is recorded in the workspace activity feed." },
];

export function LandingPage({ theme, onToggleTheme, onSignIn, onSignUp, onExploreDemo, invitePending = false }: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  /** Enter the offline prototype demo (sample data stays in this browser). */
  onExploreDemo: () => void;
  /** A `?invite=<token>` link is present; nudge the visitor to authenticate. */
  invitePending?: boolean;
}) {
  return (
    <div className="min-h-screen bg-page text-heading">
      <header className="sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-5 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-sm font-bold text-white">A</span>
          <span className="text-sm font-bold tracking-tight">Asquii</span>
          <Badge tone="brand">Workspace OS</Badge>
          <span className="flex-1" />
          <button
            className="icon-button"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            aria-pressed={theme === "dark"}
            onClick={onToggleTheme}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <Button size="sm" icon={<LogIn size={14} />} onClick={onSignIn}>
            Sign in
          </Button>
          <Button size="sm" variant="primary" icon={<UserRoundPlus size={14} />} onClick={onSignUp}>
            Create account
          </Button>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          {/* Ambient fill for the hero's top/side space — purely decorative. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {/* bg-brand holds a var(--brand-primary) hex, so alpha modifiers do not
                compile in Tailwind 3; opacity-* keeps the tint theme-aware. */}
            <div className="absolute left-1/2 top-[-14rem] h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-brand opacity-10 blur-3xl" />
            <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-brand opacity-5 blur-3xl" />
            <div className="absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-brand opacity-5 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-20 text-center sm:pb-20 sm:pt-28 lg:pt-36">
            <Badge tone="success">Live backend · Supabase auth</Badge>
            <h1 className="mx-auto mt-6 max-w-6xl text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl xl:text-8xl">
              Plan the work. Meet the people. Ship the project.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-muted sm:text-lg">
              Asquii keeps workspaces, projects, tasks, meetings and resources in one place — with
              roles that match how your team actually works. Sign in to use your real workspace, or
              look around the sample demo first.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" onClick={onSignUp} icon={<ArrowRight size={15} />}>
                Get started
              </Button>
              <Button onClick={onExploreDemo} icon={<FolderKanban size={15} />}>
                Explore the demo mock
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-muted">
              The demo runs on sample data stored in this browser only — nothing you type there reaches the server.
            </p>
            {invitePending && (
              <div className="mx-auto mt-6 max-w-xl rounded-xl border border-line bg-warning-soft px-4 py-3 text-left">
                <p className="text-xs font-semibold text-heading">You have a workspace invitation</p>
                <p className="mt-1 text-[11px] text-muted">
                  Sign in or create an account with the email address that received the invitation —
                  acceptance is validated against that address.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" icon={<LogIn size={13} />} onClick={onSignIn}>Sign in to accept</Button>
                  <Button size="sm" onClick={onSignUp}>Create account</Button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-14">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(feature => (
              <div key={feature.title} className="rounded-2xl border border-line bg-surface p-4">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">{feature.icon}</span>
                <h2 className="mt-3 text-sm font-semibold text-heading">{feature.title}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck size={16} className="text-brand" />
              <h2 className="text-sm font-semibold text-heading">How it works</h2>
            </div>
            <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-hover text-[10px] font-semibold text-secondary">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-heading">{step.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <p className="text-[11px] text-muted">
                Already have an account? Your workspace data lives in Asquii, not on this device.
              </p>
              <Button size="sm" variant="ghost" onClick={onSignIn} icon={<LogIn size={13} />}>
                Sign in
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-5 py-4 text-[11px] text-muted">
          <span className="font-semibold text-secondary">Asquii</span>
          <span>· Workspaces, projects, tasks, meetings and resources with real role-based access.</span>
        </div>
      </footer>
    </div>
  );
}
