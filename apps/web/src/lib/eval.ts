'use client';

import useSWR from 'swr';
import type {
  EvalCase,
  EvalDatasetSummary,
  EvalRunDetail,
  EvalRunSummary,
  ThresholdSimRow,
  UpsertCaseRequest,
} from '@kb/shared';
import { apiFetch, fetcher } from '@/lib/api';

export interface DatasetDetail {
  id: string;
  name: string;
  description: string | null;
  cases: EvalCase[];
}

export const datasetsKey = '/evaluation/datasets';
export const datasetKey = (id: string) => `/evaluation/datasets/${id}`;
export const runsKey = (datasetId: string) => `/evaluation/datasets/${datasetId}/runs`;
export const runKey = (runId: string) => `/evaluation/runs/${runId}`;

export function useDatasets() {
  const { data, mutate } = useSWR<EvalDatasetSummary[]>(datasetsKey, fetcher);
  return { datasets: data, mutate };
}
export function useDataset(id: string | undefined) {
  const { data, mutate, isLoading } = useSWR<DatasetDetail>(id ? datasetKey(id) : null, fetcher);
  return { dataset: data, mutate, isLoading };
}
export function useRuns(datasetId: string | undefined) {
  const { data, mutate } = useSWR<EvalRunSummary[]>(datasetId ? runsKey(datasetId) : null, fetcher);
  return { runs: data, mutate };
}
export function useRun(runId: string | undefined, refresh = false) {
  const { data, mutate } = useSWR<EvalRunDetail>(runId ? runKey(runId) : null, fetcher, {
    refreshInterval: refresh ? 2500 : 0,
  });
  return { detail: data, mutate };
}

export const createDataset = (name: string, description?: string) =>
  apiFetch<EvalDatasetSummary>(datasetsKey, { method: 'POST', body: JSON.stringify({ name, description }) });

export const createCase = (datasetId: string, body: UpsertCaseRequest) =>
  apiFetch<EvalCase>(`/evaluation/datasets/${datasetId}/cases`, { method: 'POST', body: JSON.stringify(body) });

export const updateCase = (caseId: string, body: UpsertCaseRequest) =>
  apiFetch<EvalCase>(`/evaluation/cases/${caseId}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteCase = (caseId: string) =>
  apiFetch(`/evaluation/cases/${caseId}`, { method: 'DELETE' });

export const startRun = (datasetId: string) =>
  apiFetch<EvalRunSummary>(`/evaluation/datasets/${datasetId}/runs`, { method: 'POST' });

export const simulateThresholds = (runId: string, adequacyScores: number[]) =>
  apiFetch<ThresholdSimRow[]>(`/evaluation/runs/${runId}/simulate`, {
    method: 'POST',
    body: JSON.stringify({ adequacyScores }),
  });

export const searchDocuments = (q: string) =>
  apiFetch<{ documentId: string; documentName: string }[]>(`/evaluation/documents?q=${encodeURIComponent(q)}`);

export const pct = (n: number) => `${Math.round(n * 100)}%`;
