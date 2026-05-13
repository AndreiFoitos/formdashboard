import { useAuthStore } from '../store/auth'

export function Dashboard() {
  const { user } = useAuthStore()

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      <header className="px-4 pt-12 pb-4">
        <p className="text-zinc-500 text-sm">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-2xl font-bold mt-0.5">Protocol</h1>
      </header>

      <main className="px-4 space-y-4">
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Signed in as</p>
          <p className="text-white font-medium">{user?.email}</p>
          {user?.name && <p className="text-zinc-400 text-sm mt-0.5">{user.name}</p>}
        </div>

        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Form Score</p>
          <p className="text-zinc-400 text-sm">Calibrating… complete onboarding to begin.</p>
        </div>
      </main>
    </div>
  )
}