'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { mutate } from 'swr';
import {
  Cloud,
  FolderPlus,
  HardDrive,
  Home,
  LogOut,
  Plug,
  Plus,
  Search,
  Settings,
  Upload,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api';
import {
  useDefaultSpace,
  uploadDocuments,
  foldersKey,
  docsKey,
  folderIdFromPath,
} from '@/lib/kb';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/ask', label: 'Ask', icon: Search },
  { href: '/connectors', label: 'Connected sources', icon: Plug },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { spaceId } = useDefaultSpace();

  const isLogin = pathname === '/login';
  const folderId = folderIdFromPath(pathname);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [folderModal, setFolderModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user && !isLogin) router.replace('/login');
  }, [loading, user, isLogin, router]);

  async function refresh() {
    if (!spaceId) return;
    await Promise.all([mutate(foldersKey(spaceId)), mutate(docsKey(spaceId, folderId))]);
  }

  async function onUpload(files: FileList | null) {
    if (!files || !spaceId) return;
    setErr(null);
    try {
      await uploadDocuments(spaceId, folderId, files);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    }
  }

  async function createFolder() {
    const name = newName.trim();
    if (!name || !spaceId) return;
    try {
      await apiFetch(`/spaces/${spaceId}/folders`, {
        method: 'POST',
        body: JSON.stringify({ name, ...(folderId ? { parentId: folderId } : {}) }),
      });
      setNewName('');
      setFolderModal(false);
      await mutate(foldersKey(spaceId));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not create folder');
    }
  }

  async function connect(type: 'gdrive' | 'sharepoint') {
    if (!spaceId) return;
    try {
      const { url } = await apiFetch<{ url: string }>(`/connectors/${type}/auth-url?spaceId=${spaceId}`);
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to start OAuth (check API credentials)');
    }
  }

  if (isLogin) return <>{children}</>;
  if (loading || !user) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r bg-background px-3 py-4">
        <div className="mb-4 flex items-center gap-2 px-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10">
            <HardDrive className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold">Knowledge Base</span>
        </div>

        {/* New button */}
        <div className="relative px-1">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-3 rounded-2xl border bg-background px-5 py-3.5 text-sm font-medium shadow-sm transition-shadow hover:shadow-md"
          >
            <Plus className="h-5 w-5" /> New
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-1 z-20 mt-1 w-60 rounded-lg border bg-background p-1.5 shadow-lg">
                <MenuItem icon={<FolderPlus className="h-4 w-4" />} label="New folder" onClick={() => { setMenuOpen(false); setFolderModal(true); }} />
                <MenuItem icon={<Upload className="h-4 w-4" />} label="File upload" onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }} />
                <div className="my-1 border-t" />
                <MenuItem icon={<Cloud className="h-4 w-4" />} label="Connect Google Drive" onClick={() => { setMenuOpen(false); connect('gdrive'); }} />
                <MenuItem icon={<Cloud className="h-4 w-4" />} label="Connect SharePoint" onClick={() => { setMenuOpen(false); connect('sharepoint'); }} />
              </div>
            </>
          )}
        </div>

        <nav className="mt-5 flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/' || pathname.startsWith('/folders')
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-4 rounded-full px-4 py-2 text-sm transition-colors',
                  active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80 hover:bg-accent',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-end border-b bg-background px-6">
          <div className="relative">
            <button
              onClick={() => setAccountOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border px-1 py-1 pl-3 hover:bg-accent"
            >
              <span className="text-sm text-muted-foreground">{user.email}</span>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {user.email[0]?.toUpperCase()}
              </span>
            </button>
            {accountOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAccountOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border bg-background p-1.5 shadow-lg">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {user.email[0]?.toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{user.email}</div>
                      <div className="text-xs capitalize text-muted-foreground">{user.role}</div>
                    </div>
                  </div>
                  <div className="my-1 border-t" />
                  <Link
                    href="/settings"
                    onClick={() => setAccountOpen(false)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent"
                  >
                    <Settings className="h-4 w-4" /> Settings
                  </Link>
                  <button
                    onClick={() => {
                      setAccountOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl p-6">
            {err && <p className="mb-3 text-sm text-destructive">{err}</p>}
            {children}
          </div>
        </main>
      </div>

      {/* Hidden upload input (sidebar New → File upload) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.markdown"
        className="hidden"
        onChange={(e) => onUpload(e.target.files)}
      />

      {/* New folder modal */}
      {folderModal && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/30" onClick={() => setFolderModal(false)}>
          <div className="w-80 rounded-xl border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-base font-medium">New folder</div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Untitled folder"
              className="w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFolder();
                if (e.key === 'Escape') setFolderModal(false);
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setFolderModal(false)} className="rounded-full px-4 py-1.5 text-sm font-medium text-primary hover:bg-accent">
                Cancel
              </button>
              <button onClick={createFolder} disabled={!newName.trim()} className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent">
      {icon}
      {label}
    </button>
  );
}
