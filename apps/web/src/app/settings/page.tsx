'use client';

import { useAuth } from '@/lib/auth';
import { API_BASE } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Email" value={user?.email ?? '—'} />
          <Row label="Role" value={user?.role ?? '—'} />
          <Row label="Organization" value={user?.organizationId ?? '—'} />
          <Row label="API endpoint" value={API_BASE} />
        </CardContent>
      </Card>

      <Button variant="destructive" onClick={logout}>
        Sign out
      </Button>
    </div>
  );
}
