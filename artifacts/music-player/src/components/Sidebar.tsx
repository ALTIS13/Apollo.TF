import { Link, useLocation } from "wouter";
import { Music2, Search, Heart, ListMusic, Plug, Sparkles, LogOut } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";

interface SidebarProps {
  onClose?: () => void;
}

const navItems = [
  { to: "/", label: "Поиск", icon: Search, section: "Музыка" },
  { to: "/discover", label: "Рекомендации", icon: Sparkles, section: "Музыка" },
  { to: "/favorites", label: "Коллекция", icon: Heart, section: "Библиотека" },
  { to: "/queue", label: "Очередь", icon: ListMusic, section: "Библиотека" },
  { to: "/integrations", label: "Подключения", icon: Plug, section: "Аккаунт" },
];

function isCurrentRoute(location: string, to: string) {
  return to === "/" ? location === "/" : location === to || location.startsWith(`${to}/`);
}

export function MobileNavigation() {
  const [location] = useLocation();
  return (
    <nav aria-label="Мобильная навигация" className="tf-mobile-nav grid md:hidden">
      {navItems.filter((item) => item.to !== "/integrations").map((item) => {
        const active = isCurrentRoute(location, item.to);
        const Icon = item.icon;
        return (
          <Link key={item.to} href={item.to} aria-current={active ? "page" : undefined}
            className={`tf-mobile-link ${active ? "is-active" : ""}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ onClose }: SidebarProps) {
  const [location] = useLocation();
  const { session, logout } = useTfAuth();

  return (
    <div className="flex min-h-full flex-col py-5">
      {/* Logo */}
      <div className="px-5 pb-7 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg border border-[#a78bfa]/30 bg-[#a78bfa]/10 flex items-center justify-center">
            <Music2 className="w-5 h-5 text-[#c4b5fd]" />
          </div>
          <span className="font-semibold text-white tracking-normal text-base">Apollo TF</span>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Основная навигация" className="px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = isCurrentRoute(location, item.to);
          const Icon = item.icon;
          const firstInSection = navItems.find((other) => other.section === item.section) === item;
          return (
            <div key={item.to}>
              {firstInSection && <p className="px-3 pb-2 pt-4 text-xs font-medium text-white/40">{item.section}</p>}
            <Link
              href={item.to}
              onClick={onClose}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#8ddbd4] ${
                isActive
                  ? "bg-white/8 text-white"
                  : "text-[#aaa9ba] hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className={`h-[18px] w-[18px] ${isActive ? "text-[#8ddbd4]" : "text-white/45"}`} aria-hidden="true" />
              {item.label}
            </Link>
            </div>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/8 px-5 pt-4 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-xs text-white/45">
          {session?.accountId.slice(0, 8)}...
        </span>
        <button
          type="button"
          title="Выйти"
          aria-label="Выйти"
          onClick={() => void logout()}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-[#8ddbd4]"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
