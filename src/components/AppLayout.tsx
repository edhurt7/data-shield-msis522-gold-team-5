import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ShieldLogo } from "@/components/ShieldLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { LayoutDashboard, History, User, LogOut, Shield } from "lucide-react";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "History", url: "/history", icon: History },
  { title: "Profile", url: "/profile", icon: User },
];

function DesktopSidebar() {
  const { logout } = useAuth();

  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" aria-label="Main navigation">
      <div className="flex h-14 items-center gap-2 border-b px-4 overflow-hidden">
        <Shield className="h-6 w-6 shrink-0 text-primary fill-primary/10" aria-hidden="true" />
        {!collapsed && <span className="font-display font-bold tracking-tight text-foreground text-base whitespace-nowrap">DetraceMe</span>}
      </div>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" aria-hidden="true" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div className="mt-auto border-t p-3">
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={logout} aria-label="Sign out">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span>Sign Out</span>
        </Button>
      </div>
    </Sidebar>
  );
}

function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t bg-card px-2 py-2 md:hidden" aria-label="Main navigation">
      {navItems.map((item) => {
        const active = location.pathname === item.url;
        return (
          <button
            key={item.title}
            onClick={() => navigate(item.url)}
            aria-label={item.title}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              active ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <item.icon className="h-5 w-5" aria-hidden="true" />
            <span>{item.title}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function AppLayout() {
  const isMobile = useIsMobile();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        {!isMobile && <DesktopSidebar />}
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
            <div className="flex items-center">
              {!isMobile && <SidebarTrigger className="mr-3" aria-label="Toggle sidebar" />}
              {isMobile && <ShieldLogo size="sm" />}
            </div>
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-y-auto pb-20 md:pb-0" role="main">
            <Outlet />
          </main>
          {isMobile && <MobileBottomNav />}
        </div>
      </div>
    </SidebarProvider>
  );
}
