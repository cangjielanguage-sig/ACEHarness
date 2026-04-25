import { notFound } from 'next/navigation';
import AbsoluteFilePreview from '@/components/AbsoluteFilePreview';

interface PageProps {
  params: Promise<{ filePath: string[] }>;
}

const ROOT_SEGMENTS = new Set(['Users', 'home', 'tmp', 'var', 'private', 'opt', 'etc']);

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export default async function AbsoluteFilePreviewPage({ params }: PageProps) {
  const { filePath } = await params;
  const segments = (filePath || []).map(decodeSegment).filter(Boolean);
  const last = segments[segments.length - 1] || '';

  if (segments.length < 2) notFound();
  if (!ROOT_SEGMENTS.has(segments[0])) notFound();
  if (!last.includes('.')) notFound();

  const absolutePath = `/${segments.join('/')}`;
  return <AbsoluteFilePreview absolutePath={absolutePath} />;
}
