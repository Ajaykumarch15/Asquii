import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Avatar, AvatarGroup, Badge, Button, EmptyState, Select, StateMessage, Tabs, TextInput, Textarea } from "./ui";

export function ComponentShowcase() {
  const [tab, setTab] = useState("Overview");
  return <section className="mt-8 space-y-4">
    <div><h2 className="text-lg font-semibold tracking-tight">Component library</h2><p className="mt-1 text-sm text-muted">Reusable building blocks for Asquii screens.</p></div>
    <div className="grid gap-4 xl:grid-cols-2">
      <ShowcaseCard title="Buttons & badges">
        <div className="flex flex-wrap items-center gap-2"><Button variant="primary" icon={<Plus size={15} />}>Create project</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Delete</Button></div>
        <div className="mt-4 flex flex-wrap gap-2"><Badge tone="brand">In progress</Badge><Badge tone="success">Complete</Badge><Badge tone="warning">In review</Badge><Badge tone="danger">At risk</Badge><Badge>Draft</Badge></div>
      </ShowcaseCard>
      <ShowcaseCard title="People">
        <div className="flex items-center gap-4"><Avatar name="Ava Johnson" size="lg" /><Avatar name="Sam Lee" color="blue" /><Avatar name="Maya Patel" color="green" /><AvatarGroup names={["Ava Johnson", "Sam Lee", "Maya Patel", "Noah Kim", "Iris Chen"]} /></div>
        <p className="mt-3 text-xs text-muted">Avatars support initials, sizes, color variants, and grouped people.</p>
      </ShowcaseCard>
      <ShowcaseCard title="Form fields">
        <div className="grid gap-3 sm:grid-cols-2"><TextInput label="Project name" placeholder="e.g. Website refresh" /><Select label="Status" defaultValue="progress"><option value="progress">In progress</option><option>In review</option><option>Complete</option></Select></div>
        <div className="mt-3"><Textarea label="Description" placeholder="What is this project about?" rows={2} /></div>
        <div className="mt-3"><TextInput label="Search people" placeholder="Search by name or email" icon={<Search size={15} />} /></div>
      </ShowcaseCard>
      <ShowcaseCard title="Navigation & states">
        <Tabs items={["Overview", "Activity", "Files"]} active={tab} onChange={setTab} />
        <div className="mt-3 grid gap-2 sm:grid-cols-2"><StateMessage kind="loading" title="Loading projects">Getting your latest updates…</StateMessage><StateMessage kind="success" title="Changes saved">Your project is up to date.</StateMessage></div>
      </ShowcaseCard>
    </div>
    <div className="rounded-lg border border-line bg-surface"><EmptyState title="Your next pattern goes here" description="Empty, error, and loading patterns can be composed with the same shared components." action={<Button variant="secondary" size="sm">Explore patterns</Button>} /></div>
  </section>;
}

function ShowcaseCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="rounded-lg border border-line bg-surface p-5"><h3 className="mb-4 text-sm font-semibold">{title}</h3>{children}</article>;
}
