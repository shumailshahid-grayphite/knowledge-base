import { Badge } from '@/components/ui/badge';

type Status = 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed' | 'needs_review';

const MAP: Record<Status, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline' }> = {
  uploaded: { label: 'Uploaded', variant: 'secondary' },
  queued: { label: 'Queued', variant: 'secondary' },
  processing: { label: 'Processing', variant: 'default' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  needs_review: { label: 'Needs review', variant: 'warning' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = MAP[status as Status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
