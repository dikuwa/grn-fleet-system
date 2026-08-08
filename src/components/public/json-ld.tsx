/**
 * JSON-LD structured data — renders a safe, server-side <script> block.
 *
 * Only plain serialisable objects are accepted; values come from code or
 * sanitised CMS copy, so nothing user-controlled is ever executed.
 */

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
