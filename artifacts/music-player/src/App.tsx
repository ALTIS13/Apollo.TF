import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PlayerProvider, usePlayer } from "@/hooks/use-player";
import { Player } from "@/components/Player";
import { MobileNavigation, Sidebar } from "@/components/Sidebar";
import { TfAuthProvider } from "@/auth/tf-auth";
import { TfSessionBoundary } from "@/auth/TfSessionBoundary";
import { useState, useEffect } from "react";
import { Menu } from "lucide-react";
import Home from "@/pages/Home";
import Favorites from "@/pages/Favorites";
import Integrations from "@/pages/Integrations";
import Discover from "@/pages/Discover";
import Queue from "@/pages/Queue";
import NotFound from "@/pages/not-found";
import { setBaseUrl } from "@workspace/api-client-react";

if (import.meta.env.VITE_API_URL) {
  setBaseUrl((import.meta.env.VITE_API_URL as string).replace(/\/+$/, ""));
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/discover" component={Discover} />
      <Route path="/queue" component={Queue} />
      <Route path="/favorites" component={Favorites} />
      <Route path="/integrations" component={Integrations} />
      <Route component={NotFound} />
    </Switch>
  );
}

function GlobalHotkeys() {
  const { togglePlayPause, seekBy, setVolume, volume } = usePlayer();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName) ||
        el.isContentEditable
      )
        return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlayPause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-10);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume(Math.min(1, volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.05));
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlayPause, seekBy, setVolume, volume]);

  return null;
}

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  // Close mobile sidebar on nav
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  return (
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="tf-app-shell flex flex-col overflow-hidden bg-background">
        <a href="#tf-main-content" className="tf-skip-link">К музыке</a>
        <GlobalHotkeys />

        <div className="flex flex-1 overflow-hidden">
          {/* Desktop sidebar */}
          <aside className="hidden md:flex flex-col w-[224px] flex-shrink-0 border-r border-white/8 bg-[#0e0e12] overflow-y-auto">
            <Sidebar />
          </aside>

          {/* Mobile sidebar overlay */}
          <SheetContent
            side="left"
            aria-describedby={undefined}
            className="w-[min(280px,85vw)] overflow-y-auto bg-[#0e0e12] p-0 motion-reduce:transition-none motion-reduce:animate-none"
          >
            <SheetTitle className="sr-only">Навигация Apollo TF</SheetTitle>
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </SheetContent>

          {/* Main content */}
          <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
            {/* Mobile top bar */}
            <div className="md:hidden flex items-center gap-3 px-4 h-12 border-b border-white/8 bg-[#0e0e12]/90 backdrop-blur-xl flex-shrink-0">
              <SheetTrigger asChild>
                <button
                  aria-label="Открыть меню"
                  title="Открыть меню"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:text-white focus-visible:outline-2 focus-visible:outline-white transition-colors"
                >
                  <Menu className="w-5 h-5" />
                </button>
              </SheetTrigger>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md border border-white/15 bg-white/5 flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">A</span>
                </div>
                <span className="text-white text-sm font-semibold tracking-normal">
                  Apollo TF
                </span>
              </div>
            </div>

            {/* Scrollable content */}
            <main id="tf-main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none">
              <Router />
            </main>
          </div>
        </div>

        {/* Bottom player — always visible */}
        <Player />
        <MobileNavigation />
      </div>
    </Sheet>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TfAuthProvider>
          <TfSessionBoundary>
            <PlayerProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <AppLayout />
              </WouterRouter>
              <Toaster />
            </PlayerProvider>
          </TfSessionBoundary>
        </TfAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
