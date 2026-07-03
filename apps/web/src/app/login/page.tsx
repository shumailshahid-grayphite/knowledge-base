'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const router = useRouter();
  const { loginDev, loginPassword } = useAuth();
  const [email, setEmail] = useState('owner@acme.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(mode: 'dev' | 'password') {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'dev') await loginDev(email);
      else await loginPassword(email, password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Enterprise Knowledge Base</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password (optional in dev)</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col gap-2">
            <Button disabled={busy} onClick={() => submit(password ? 'password' : 'dev')}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Dev mode: sign in with just an email (requires AUTH_DEV_MODE=true on the API).
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
