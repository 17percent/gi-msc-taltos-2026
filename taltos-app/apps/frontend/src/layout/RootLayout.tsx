import { Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { AuthProvider } from '../auth/AuthProvider';
import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui/button';
import { Alert } from '../components/ui/display';
import { Dialog, DialogTrigger, SheetContent } from '../components/ui/dialog';
import { Toaster } from '../components/ui/sonner';
import { CreateDocumentDialog } from '../documents/CreateDocumentDialog';
import { SpaceProvider } from '../spaces/SpaceProvider';
import { SidebarContent } from './Sidebar';
import { UserMenu } from './UserMenu';

/**
 * A dialógus nem `DialogTrigger`-ből nyílik, ezért a fókuszt mi adjuk vissza az indító gombra (spec 2.).
 * Mobilon a gomb a bezárt Sheetben volt (és az asztali oldalsáv rejtett): a „Menü megnyitása” gomb a tartalék.
 */
function returnFocusToOpener(event: Event): void {
  event.preventDefault();
  const opener = document.getElementById('new-document-button');
  opener?.focus();
  if (!opener || document.activeElement !== opener) {
    document.getElementById('open-menu-button')?.focus();
  }
}

function Shell() {
  const { state, logoutFailed } = useAuth();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const firstRender = useRef(true);
  const signedIn = state.kind === 'signed-in';

  // Útvonalváltáskor a fókusz az oldal h1-ére kerül (spec 2.1); az első betöltésre nem.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.querySelector<HTMLElement>('#main-content h1')?.focus();
  }, [location.pathname]);

  return (
    <div className="min-h-dvh bg-bg text-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-toast) focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-text focus:shadow-(--shadow-md)"
      >
        Ugrás a tartalomra
      </a>
      <header className="sticky top-0 z-(--z-sticky) border-b border-border bg-surface">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Dialog open={navOpen} onOpenChange={setNavOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Menü megnyitása"
                    id="open-menu-button"
                    className="lg:hidden"
                  >
                    <Menu aria-hidden="true" className="size-5" />
                  </Button>
                </DialogTrigger>
                <SheetContent title="Menü">
                  <SidebarContent
                    onNavigate={() => setNavOpen(false)}
                    onNewDocument={() => setCreateOpen(true)}
                  />
                </SheetContent>
              </Dialog>
            ) : null}
            <Link
              to="/"
              className="rounded-md font-display text-xl font-semibold tracking-tight text-text no-underline"
            >
              Táltos
            </Link>
          </div>
          <UserMenu />
        </div>
      </header>
      {logoutFailed ? (
        <div className="px-4 pt-4 sm:px-6">
          <Alert tone="danger">A kijelentkezés nem sikerült. Próbáld újra.</Alert>
        </div>
      ) : null}
      <div className="flex">
        {signedIn ? (
          <aside className="sticky top-16 hidden h-[calc(100dvh-var(--space-16))] w-(--sidebar-w) shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface p-4 lg:flex">
            <SidebarContent onNewDocument={() => setCreateOpen(true)} />
          </aside>
        ) : null}
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-w-0 max-w-(--content-max) flex-1 px-4 py-10 focus:outline-none sm:px-6"
        >
          <Outlet />
        </main>
      </div>
      {signedIn ? (
        <CreateDocumentDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="blank"
          onCloseAutoFocus={returnFocusToOpener}
        />
      ) : null}
      <Toaster />
    </div>
  );
}

export function RootLayout() {
  return (
    <AuthProvider>
      <SpaceProvider>
        <Shell />
      </SpaceProvider>
    </AuthProvider>
  );
}
