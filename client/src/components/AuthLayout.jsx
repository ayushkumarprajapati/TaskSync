export default function AuthLayout({ children }) {
  return (
    <div className="auth-layout">
      <aside className="intro">
        <a className="brand" href="#/login"><span className="brand-icon" aria-hidden="true">✓</span>TaskSync.</a>
        <div className="intro-copy">
          <p className="eyebrow">A little clarity. A lot of progress.</p>
          <h1>Good work starts<br />with a clear plan.</h1>
          <p>A shared place for your team’s tasks, priorities, and next steps.</p>
          <div className="plan-preview" aria-hidden="true">
            <div className="preview-heading"><span>Small steps, real progress</span><span>↗</span></div>
            <div className="preview-row"><span className="check complete">✓</span><span>Bring the team together</span><span className="pill">People</span></div>
            <div className="preview-row"><span className="check">2</span><span>Make a plan that works</span><span className="pill">Focus</span></div>
            <div className="preview-row"><span className="check">3</span><span>Move forward, together</span><span className="pill">Progress</span></div>
          </div>
        </div>
        <p className="intro-footer">Less scattered. More in sync.</p>
      </aside>
      <main className="auth-main"><div className="auth-card">{children}</div><p className="form-footer">TaskSync · Collaborative task management</p></main>
    </div>
  );
}
