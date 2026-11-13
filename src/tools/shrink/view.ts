import { blobLink, formatSize } from '../../ui';
import { placeholderPdf } from './placeholder-pdf';
import { shrinkZip } from './shrink';

const html = `
  <h2>Allègement d’archives ZIP</h2>
  <p class="lead">Chaque PDF des archives déposées est remplacé par un PDF d’une page indiquant
    « Ce document a été remplacé pour des besoins de test ».
    <a data-id="preview" href="#" target="_blank">Voir le PDF de remplacement</a></p>
  <label class="drop" data-id="drop">
    <input data-id="file" type="file" accept=".zip,application/zip" multiple>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
    <strong>Glissez vos archives .zip ici</strong>
    <span>ou cliquez pour les choisir, plusieurs fichiers possibles</span>
  </label>
  <ul class="results" data-id="results"></ul>`;

export function mount(container: HTMLElement) {
  container.innerHTML = html;
  const $ = <T extends HTMLElement>(id: string) =>
    container.querySelector(`[data-id="${id}"]`) as T;
  const drop = $('drop');
  const input = $<HTMLInputElement>('file');
  const results = $('results');
  const pdf = placeholderPdf();

  $<HTMLAnchorElement>('preview').href = URL.createObjectURL(
    new Blob([pdf as BlobPart], { type: 'application/pdf' }),
  );

  function addResult(name: string) {
    const li = document.createElement('li');
    li.className = 'result';
    li.innerHTML = '<span class="name"></span><span class="status">Traitement…</span>';
    li.querySelector('.name')!.textContent = name;
    results.prepend(li);
    return li;
  }

  async function processFile(file: File) {
    const li = addResult(file.name);
    const status = li.querySelector('.status')!;
    try {
      const { blob, replaced } = await shrinkZip(file, pdf);
      const gain = Math.max(Math.round((1 - blob.size / file.size) * 100), 0);
      status.textContent = `${replaced} PDF remplacé(s) · ${formatSize(file.size)} → ${formatSize(blob.size)}`;
      li.insertAdjacentHTML('beforeend', `<span class="gain">−${gain} %</span>`);
      const a = document.createElement('a');
      a.className = 'download';
      blobLink(a, blob, `${file.name.replace(/\.zip$/i, '')}-fake.zip`);
      a.textContent = `Télécharger ${a.download}`;
      li.append(a);
      li.classList.add('done');
      a.click();
    } catch (e) {
      li.classList.add('error');
      status.textContent = `Erreur : ${e instanceof Error ? e.message : e}`;
    }
  }

  async function processAll(files: File[]) {
    for (const file of files) await processFile(file);
    input.value = '';
  }

  input.addEventListener('change', () => processAll([...input.files!]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    processAll([...e.dataTransfer!.files].filter((f) => /\.zip$/i.test(f.name)));
  });
}
