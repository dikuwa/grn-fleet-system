import { NativeDocumentPrintLauncher } from './native-document-print-launcher';

export default async function DocumentPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NativeDocumentPrintLauncher documentId={id} />;
}
