'use client';

import { useParams } from 'next/navigation';
import { FileBrowser } from '@/components/file-browser';

export default function FolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  return <FileBrowser folderId={folderId} />;
}
