'use client';

import useSWR from 'swr';
import type {
  GapStatus,
  KnowledgeGapDetail,
  KnowledgeGapMetrics,
  KnowledgeGapSummary,
} from '@kb/shared';
import { apiFetch, fetcher } from '@/lib/api';

export const gapsKey = (status?: GapStatus) =>
  `/knowledge-gaps${status ? `?status=${status}` : ''}`;
export const gapKey = (id: string) => `/knowledge-gaps/${id}`;
export const gapMetricsKey = '/knowledge-gaps/metrics';

export function useKnowledgeGaps(status?: GapStatus) {
  const { data, error, isLoading, mutate } = useSWR<KnowledgeGapSummary[]>(gapsKey(status), fetcher);
  return { gaps: data, error, isLoading, mutate };
}

export function useKnowledgeGap(id: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<KnowledgeGapDetail>(
    id ? gapKey(id) : null,
    fetcher,
  );
  return { gap: data, error, isLoading, mutate };
}

export function useGapMetrics(enabled: boolean) {
  const { data } = useSWR<KnowledgeGapMetrics>(enabled ? gapMetricsKey : null, fetcher);
  return { metrics: data };
}

export function updateGapStatus(id: string, status: GapStatus) {
  return apiFetch(`/knowledge-gaps/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** owner/admin see the Knowledge Gaps dashboard (mirrors the API RolesGuard). */
export function isAdminRole(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin';
}
