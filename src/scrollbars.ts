// Match the thin native scrollbars of Codex's sidebar in both preview documents.
export const scrollbarStyle = `
/* Keep the PDF render width stable when its first page overflows. */
body:not(.native-preview) #viewers, #scan-viewers { scrollbar-gutter: stable; }
:where(#viewers, #compile-error, #typst-container-main, #scan-viewers) {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in oklab, var(--vscode-foreground, #ccc) 8%, transparent) transparent;
}
:where(#viewers, #compile-error, #typst-container-main, #scan-viewers):is(:hover, :active) {
  scrollbar-color: color-mix(in oklab, var(--vscode-foreground, #ccc) 12%, transparent) transparent;
}
`;
