// Dashboard loading skeleton
export default function DashboardLoading() {
  return (
    <div style={{ padding: "36px 44px" }}>
      <div className="ak-shimmer" style={{ height: 32, width: 200, borderRadius: "var(--radius-md)", marginBottom: 8 }} />
      <div className="ak-shimmer" style={{ height: 16, width: 320, borderRadius: "var(--radius-sm)", marginBottom: 32 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 32 }}>
        {[0,1,2,3].map(i => <div key={i} className="ak-shimmer" style={{ height: 96, borderRadius: "var(--radius-lg)" }} />)}
      </div>
      <div className="ak-shimmer" style={{ height: 280, borderRadius: "var(--radius-lg)" }} />
    </div>
  );
}
