// Match the thin native scrollbars of Codex's sidebar in both preview documents.
export const scrollbarStyle = `
:where(#viewers, #compile-error, #typst-container-main) {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in oklab, var(--vscode-foreground, #ccc) 8%, transparent) transparent;
}
:where(#viewers, #compile-error, #typst-container-main):is(:hover, :active) {
  scrollbar-color: color-mix(in oklab, var(--vscode-foreground, #ccc) 12%, transparent) transparent;
}
`;
