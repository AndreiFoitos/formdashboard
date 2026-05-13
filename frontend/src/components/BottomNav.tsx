import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Today',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    to: '/training',
    label: 'Training',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 6.5h11M6.5 17.5h11M4 12h16M2 9.5l2 2.5-2 2.5M22 9.5l-2 2.5 2 2.5" />
      </svg>
    ),
  },
  {
    to: '/nutrition',
    label: 'Nutrition',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a7 7 0 0 1 7 7c0 4-3.5 7-7 13C8.5 16 5 13 5 9a7 7 0 0 1 7-7z" />
      </svg>
    ),
  },
  {
    to: '/body',
    label: 'Body',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v8m-4-5 4 2 4-2M9 20l3-5 3 5" />
      </svg>
    ),
  },
  {
    to: '/ask',
    label: 'Ask',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
]

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur border-t border-zinc-900 pb-safe">
      <div className="flex">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                isActive ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'
              }`
            }
          >
            {item.icon}
            <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}