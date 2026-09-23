import { Link, useLocation } from "wouter";
import { Music2, Search, Heart, ListMusic, Plug, Sparkles, LogOut } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const [location] = useLocation();
  const { session, logout } = useTfAuth();

  const navItems = [
    { to: "/", label: "Поиск", icon: <Search className="w-4 h-4" />, exact: true },
    { to: "/discover", label: "Рекомендации", icon: <Sparkles className="w-4 h-4" />, exact: false },
    { to: "/queue", label: "Очередь", icon: <ListMusic className="w-4 h-4" />, exact: false },
    { to: "/favorites", label: "Коллекция", icon: <Heart className="w-4 h-4" />, exact: false },
    { to: "/integrations", label: "Подключения", icon: <Plug className="w-4 h-4" />, exact: false },
  ];

  return (
    <div className="flex flex-col h-full py-4">
      {/* Logo */}
      <div className="px-4 pb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg border border-white/15 bg-white/5 flex items-center justify-center">
            <Music2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white tracking-normal text-sm">Apollo TF</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="px-2 space-y-0.5">
        {navItems.map((item) => {
          const isActive = item.exact ? location === "/" : location.startsWith(item.to);
          return (
            <Link
              key={item.to}
              href={item.to}
              onClick={onClose}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className={isActive ? "text-white" : "text-white/40"}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/5 px-4 pt-3 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[10px] text-white/30">
          {session?.accountId.slice(0, 8)}...
        </span>
        <button
          type="button"
          title="Выйти"
          aria-label="Выйти"
          onClick={() => void logout()}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-white/40 transition-colors hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
