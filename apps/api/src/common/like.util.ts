/**
 * Build a SQL LIKE pattern that matches a literal prefix (a materialized folder
 * path) followed by anything. Folder names may contain LIKE metacharacters
 * (`%`, `_`) — e.g. "HR_Policies" — so we escape them and pair this with
 * `ESCAPE '\'` at the call site to avoid over-matching.
 */
export function likeStartsWith(prefix: string): string {
  const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `${escaped}%`;
}
