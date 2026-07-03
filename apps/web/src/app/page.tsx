'use client';

import Link from 'next/link';
import useSWR from 'swr';
import type { SpaceResponse } from '@kb/shared';
import { fetcher } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const { data: spaces, isLoading } = useSWR<SpaceResponse[]>('/spaces', fetcher);

  const totalDocs = spaces?.reduce((sum, s) => sum + (s.documentCount ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your knowledge spaces.</p>
        </div>
        <Link href="/spaces">
          <Button>Manage spaces</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Knowledge spaces</CardDescription>
            <CardTitle className="text-3xl">{spaces?.length ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Documents</CardDescription>
            <CardTitle className="text-3xl">{totalDocs}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Your spaces</h2>
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {spaces && spaces.length === 0 && (
          <p className="text-muted-foreground">No spaces yet. Create one to get started.</p>
        )}
        <div className="grid grid-cols-2 gap-4">
          {spaces?.map((s) => (
            <Link key={s.id} href={`/spaces/${s.id}`}>
              <Card className="transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <CardDescription>{s.description || 'No description'}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {s.documentCount ?? 0} document(s)
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
