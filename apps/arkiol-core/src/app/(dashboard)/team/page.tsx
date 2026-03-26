"use client";
// src/app/(dashboard)/team/page.tsx
// Full team management: list members, invite by email, change roles, remove.
import { useState, useEffect } from "react";

const ROLES = ["ADMIN", "MANAGER", "DESIGNER", "REVIEWER", "VIEWER"] as const;
type Role = typeof ROLES[number];

const ROLE_COLOR: Record<string, string> = {
  ADMIN:    "ak-badge-error",
  SUPER_ADMIN: "ak-badge-error",
  MANAGER:  "ak-badge-warning",
  DESIGNER: "ak-badge-accent",
  REVIEWER: "ak-badge-muted",
  VIEWER:   "ak-badge-muted",
};

interface Member {
  id:        string;
  email:     string;
  name?:     string;
  role:      string;
  createdAt: string;
  _count:    { assets: number; jobs: number };
}

interface Invite {
  id:        string;
  email:     string;
  role:      string;
  createdAt: string;
  expiresAt: string;
}

export default function TeamPage() {
  const [members,      setMembers]      = useState<Member[]>([]);
  const [invites,      setInvites]      = useState<Invite[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [inviteEmail,  setInviteEmail]  = useState("");
  const [inviteRole,   setInviteRole]   = useState<Role>("DESIGNER");
  const [inviting,     setInviting]     = useState(false);
  const [inviteMsg,    setInviteMsg]    = useState<{ type: "success"|"error"; text: string } | null>(null);
  const [removing,     setRemoving]     = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [currentUser,  setCurrentUser]  = useState<Member | null>(null);
  const [planLimits,   setPlanLimits]   = useState<{ members: number } | null>(null);

  async function load() {
    const [teamRes, billingRes] = await Promise.all([
      fetch("/api/team").catch(() => null),
      fetch("/api/billing").catch(() => null),
    ]);
    if (teamRes?.ok) {
      const data = await teamRes.json();
      setMembers(data.members ?? []);
      setInvites(data.pendingInvites ?? []);
      setCurrentUser(data.currentUser ?? null);
    }
    if (billingRes?.ok) {
      const billing = await billingRes.json();
      if (billing?.planLimits) setPlanLimits(billing.planLimits);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true); setInviteMsg(null);
    const res  = await fetch("/api/team", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setInviteMsg({ type: "success", text: `Invitation sent to ${inviteEmail}` });
      setInviteEmail("");
      load();
    } else {
      setInviteMsg({ type: "error", text: data.error ?? "Failed to send invite" });
    }
    setInviting(false);
  }

  async function changeRole(userId: string, role: Role) {
    setChangingRole(userId);
    await fetch("/api/team", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    await load();
    setChangingRole(null);
  }

  async function removeMember(userId: string) {
    if (!confirm("Remove this team member? They will lose access to this workspace.")) return;
    setRemoving(userId);
    await fetch(`/api/team?userId=${userId}`, { method: "DELETE" });
    await load();
    setRemoving(null);
  }

  const canManage = currentUser?.role === "ADMIN" || currentUser?.role === "SUPER_ADMIN";
  const atLimit   = planLimits && members.length >= planLimits.members;

  const th: React.CSSProperties = { padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" };
  const td: React.CSSProperties = { padding: "12px 14px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };

  return (
    <div className="ak-fade-in" style={{ padding: "36px 44px", maxWidth: 960 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.04em" }}>Team</h1>
        <p style={{ margin: "5px 0 0", fontSize: 13.5, color: "var(--text-muted)" }}>
          Manage workspace members and permissions.
          {planLimits && <> Plan allows <strong style={{ color: "var(--text-primary)" }}>{planLimits.members === 999 ? "unlimited" : planLimits.members}</strong> members.</>}
        </p>
      </div>

      {/* Invite section */}
      {canManage && (
        <div className="ak-card" style={{ padding: 24, marginBottom: 28 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Invite a teammate</h2>
          {atLimit && (
            <div className="ak-toast ak-toast-warning" style={{ marginBottom: 14, fontSize: 13 }}>
              <span>⚠</span>
              <span>Member limit reached. <a href="/billing" style={{ color: "var(--warning)", textDecoration: "underline" }}>Upgrade your plan</a> to add more.</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="ak-form-group" style={{ flex: "1 1 260px" }}>
              <label className="ak-form-label">Email address</label>
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                className="ak-input" placeholder="colleague@company.com" disabled={!!atLimit} />
            </div>
            <div className="ak-form-group" style={{ flex: "0 0 160px" }}>
              <label className="ak-form-label">Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}
                className="ak-input ak-select" disabled={!!atLimit} style={{ paddingTop: 9, paddingBottom: 9 }}>
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <button onClick={sendInvite} disabled={inviting || !inviteEmail || !!atLimit} className="ak-btn ak-btn-primary" style={{ alignSelf: "flex-end", padding: "10px 22px" }}>
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </div>
          {inviteMsg && (
            <div className={`ak-toast ak-toast-${inviteMsg.type}`} style={{ marginTop: 12, fontSize: 13 }}>
              <span>{inviteMsg.type === "success" ? "✓" : "⚠"}</span>
              <span>{inviteMsg.text}</span>
            </div>
          )}
        </div>
      )}

      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Pending Invites</h2>
          <div className="ak-card" style={{ padding: 0, overflow: "hidden" }}>
            {invites.map((inv, i) => (
              <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderBottom: i < invites.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--bg-overlay)", border: "1px dashed var(--border-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "var(--text-muted)" }}>✉</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{inv.email}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                    Invited {new Date(inv.createdAt).toLocaleDateString()} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <span className={`ak-badge ${ROLE_COLOR[inv.role] ?? "ak-badge-muted"}`} style={{ fontSize: 10.5 }}>{inv.role}</span>
                <span className="ak-badge ak-badge-warning" style={{ fontSize: 10.5 }}>Pending</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members list */}
      <div>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          Members ({members.length})
        </h2>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[0,1,2].map(i => <div key={i} className="ak-shimmer" style={{ height: 64, borderRadius: "var(--radius-lg)" }} />)}
          </div>
        ) : (
          <div className="ak-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Member</th>
                    <th style={th}>Role</th>
                    <th style={th}>Assets</th>
                    <th style={th}>Joined</th>
                    {canManage && <th style={{ ...th, textAlign: "right" }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {members.map(member => {
                    const isCurrentUser = member.id === currentUser?.id;
                    const initials = (member.name ?? member.email).slice(0, 2).toUpperCase();
                    return (
                      <tr key={member.id}
                        style={{ transition: "background var(--transition-fast)" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{
                              width: 36, height: 36, borderRadius: "50%",
                              background: "linear-gradient(135deg, var(--accent), #9b5de5)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
                            }}>{initials}</div>
                            <div>
                              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{member.name ?? "—"} {isCurrentUser && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>(you)</span>}</div>
                              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{member.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={td}>
                          {canManage && !isCurrentUser ? (
                            <select value={member.role} disabled={changingRole === member.id}
                              onChange={e => changeRole(member.id, e.target.value as Role)}
                              className="ak-input ak-select" style={{ padding: "5px 28px 5px 10px", fontSize: 12, width: "auto" }}>
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          ) : (
                            <span className={`ak-badge ${ROLE_COLOR[member.role] ?? "ak-badge-muted"}`} style={{ fontSize: 10.5 }}>{member.role}</span>
                          )}
                        </td>
                        <td style={{ ...td, color: "var(--text-muted)", fontSize: 13 }}>
                          {member._count.assets.toLocaleString()} assets · {member._count.jobs.toLocaleString()} jobs
                        </td>
                        <td style={{ ...td, color: "var(--text-muted)", fontSize: 12.5, whiteSpace: "nowrap" }}>
                          {new Date(member.createdAt).toLocaleDateString()}
                        </td>
                        {canManage && (
                          <td style={{ ...td, textAlign: "right" }}>
                            {!isCurrentUser && (
                              <button onClick={() => removeMember(member.id)} disabled={removing === member.id}
                                className="ak-btn ak-btn-danger ak-btn-xs">
                                {removing === member.id ? "…" : "Remove"}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
