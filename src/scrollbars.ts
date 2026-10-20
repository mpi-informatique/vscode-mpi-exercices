// Shared by the webview and the embedded Tinymist document.
export const scrollbarStyle = `
::-webkit-scrollbar { width: 14px; height: 14px; background: transparent; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, .4)); }
::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, .7)); }
::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground, rgba(191, 191, 191, .4)); }
`;
