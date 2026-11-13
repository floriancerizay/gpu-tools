/** Utilitaires partagés par les outils. */

export const formatSize = (n: number): string =>
  n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1024 / 1024).toFixed(2)} Mo`;

/** Crée un lien de téléchargement sur un blob ; l'appelant gère `revokeObjectURL`. */
export function blobLink(a: HTMLAnchorElement, blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  return url;
}

export function statusLine(el: HTMLElement) {
  return (msg: string, error = false) => {
    el.textContent = msg;
    el.className = error ? 'error' : '';
  };
}

export interface Tool {
  mount(container: HTMLElement): void | Promise<void>;
}
