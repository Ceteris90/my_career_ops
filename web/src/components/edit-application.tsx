"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

export function EditApplication({ n, company, role }: { n: string; company: string; role: string }) {
  const router = useRouter();
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draftCompany, setCompany] = useState(company);
  const [draftRole, setRole] = useState(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const buttonClass = "rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-brand disabled:opacity-50 max-sm:min-h-[44px]";

  function close() {
    setEditing(false);
    requestAnimationFrame(() => button.current?.focus());
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tracker/edit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, company: draftCompany, role: draftRole, expectedCompany: company, expectedRole: role }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save changes.");
      setSaved(true);
      close();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save changes.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <div className="mt-3">
    <button ref={button} type="button" className={`${buttonClass} inline-flex items-center gap-1.5`} aria-expanded={editing} aria-controls={`${id}-form`} onClick={() => {
      if (editing) { close(); return; }
      setCompany(company); setRole(role); setError(""); setSaved(false); setEditing(true);
    }} disabled={busy}>
      <Pencil className="size-3.5" /> Edit company / role
    </button>
    {saved && <span role="status" className="ml-3 text-xs text-muted">Changes saved.</span>}
    {editing && <form id={`${id}-form`} onSubmit={save} onKeyDown={(event) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); close(); }
    }} className="mt-3 space-y-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <label htmlFor={`${id}-company`} className="mb-1 block text-sm">Company</label>
        <input autoFocus id={`${id}-company`} value={draftCompany} onChange={(event) => setCompany(event.target.value)} required maxLength={500} disabled={busy} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor={`${id}-role`} className="mb-1 block text-sm">Role</label>
        <input id={`${id}-role`} value={draftRole} onChange={(event) => setRole(event.target.value)} required maxLength={500} disabled={busy} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={busy || !draftCompany.trim() || !draftRole.trim()}>{busy ? "Saving…" : "Save changes"}</button>
        <button type="button" className={buttonClass} disabled={busy} onClick={close}>Cancel</button>
      </div>
    </form>}
  </div>;
}
