export default function App() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="px-8 py-6">
        <div className="max-w-7xl mx-auto">
          <span className="text-foreground" style={{ fontWeight: 600 }}>Puffchat</span>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="px-6 sm:px-8 py-10 md:py-32">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-muted-foreground mb-3 sm:mb-6 text-sm sm:text-base">
            Disappears when you do.
          </p>
          <h1 className="mb-4 sm:mb-6 text-5xl sm:text-6xl md:text-7xl" style={{ fontWeight: 600, lineHeight: 1.1 }}>
            Chat. Close. Gone.
          </h1>
          <p className="text-foreground/80 mb-8 sm:mb-12 max-w-xl mx-auto text-base sm:text-lg px-4">
            Share a code. Talk to someone. When you leave, it never happened.
          </p>
          <a
            href="/app"
            className="inline-block px-8 py-3.5 bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
            style={{ borderRadius: '9999px' }}
          >
            Start a chat
          </a>
        </div>
      </section>

      {/* How It Works Cards */}
      <section className="px-6 sm:px-8 pb-20">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
          <div className="bg-card border border-border p-8 sm:p-12">
            <h3 className="mb-4" style={{ fontWeight: 600 }}>Generate a code</h3>
            <p className="text-muted-foreground">
              Click start and get a unique room code. No signup, no email, nothing.
            </p>
          </div>
          <div className="bg-card border border-border p-8 sm:p-12">
            <h3 className="mb-4" style={{ fontWeight: 600 }}>Share it. Connect.</h3>
            <p className="text-muted-foreground">
              Send the code to one person. They join. You chat. Close the tab and it's gone forever.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Callouts */}
      <section className="px-6 sm:px-8 pb-32">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
          <div className="text-center">
            <p className="text-muted-foreground text-sm">Anonymous by design</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-sm">Disappears when you leave</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-sm">No accounts ever</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 sm:px-8 py-8">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-muted-foreground text-sm">
            © 2026 Puffchat
          </p>
        </div>
      </footer>
    </div>
  );
}