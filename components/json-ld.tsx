/**
 * Structured data, rendered as a `<script type="application/ld+json">`.
 *
 * The escape is not optional. `JSON.stringify` does not neutralise `</script>`,
 * so a skill name or description containing one would close this tag early and
 * inject the rest as markup — and every string that reaches this component
 * comes from a third-party SKILL.md. Replacing `<` with its unicode escape is
 * the fix Next's own guide prescribes
 * (node_modules/next/dist/docs/01-app/02-guides/json-ld.md); `<` is valid
 * inside a JSON string and parses back to `<`, so consumers see the original
 * text.
 *
 * A native `<script>` rather than `next/script`: this is data, not code, and
 * nothing should defer or dedupe it.
 *
 * Nothing here is a ranking factor. What it buys is display and comprehension:
 * `BreadcrumbList` replaces the raw URL in a result with a
 * `skillbundle.dev > anthropics > skills` trail, which is the only rich result
 * a catalog page like this is eligible for, and the graph as a whole is what
 * lets a search engine or an LLM read "this page is about a piece of software
 * published by X" rather than inferring it from prose.
 *
 * Validate changes with https://validator.schema.org/ and Google's Rich
 * Results Test before shipping them — a malformed graph is ignored silently.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
