/**
 * The characters Typesense tokenizes skill names on (the collection schema's
 * `token_separators`). Split hyphenated / underscored / dotted identifiers
 * into their component words so a search for "foundry" matches
 * "microsoft-foundry" — Typesense only splits on whitespace by default, which
 * is wrong for skill names, which are almost all identifiers.
 *
 * Lives in this dependency-free leaf because BOTH sides of the engine need
 * it and neither may import the other: the Convex admin transport
 * (convex/lib/typesense.ts) writes it into the collection schema, and the
 * browser highlight renderer (lib/search/highlight.tsx) bridges `<mark>` runs
 * split by exactly these characters — a value import of the admin module
 * would put it on the client bundle path.
 */
export const NAME_TOKEN_SEPARATORS = ["-", "_", ".", "/"];
