import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Enterprise Knowledge Base',
  description: 'Ingest, process, and ask your company documents with citations.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
