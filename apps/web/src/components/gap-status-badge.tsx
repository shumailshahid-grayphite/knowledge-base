import type { GapStatus } from '@kb/shared';
import { Badge } from '@/components/ui/badge';

export function GapStatusBadge({ status }: { status: GapStatus }) {
  const variant = status === 'open' ? 'secondary' : status === 'resolved' ? 'success' : 'outline';
  return <Badge variant={variant as 'secondary' | 'success' | 'outline'}>{status}</Badge>;
}
