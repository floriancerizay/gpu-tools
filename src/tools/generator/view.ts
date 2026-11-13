import { blobLink, statusLine } from '../../ui';
import { generateDocument, zipDocument } from './generate';
import { loadIndex, matchModels, type ModelIndexEntry, type ModelSource } from './model';

const html = `
  <h2>Générateur de faux documents d’urbanisme</h2>
  <p class="lead">
    Génère une archive conforme aux standards CNIG et GpU (modèles
    <a href="https://github.com/IGNF/validator-config-gpu">validator-config-gpu</a>) avec de faux PDF et des
    géométries issues des parcelles de la commune, ou des communes de l’EPCI, du département ou de la région.
  </p>
  <form data-id="form" novalidate>
    <label for="gen-name">Nom du document</label>
    <input id="gen-name" type="text" placeholder="25349_PLU_20240101" autocomplete="off" spellcheck="false" required />
    <p class="hint">Le format du nom dépend du type de document :</p>
    <ul class="hint">
      <li>PLU, PLUi, POS, CC, PSMV : <code>25349_PLU_20240101</code>, <code>200040715_PLUi_20240101</code></li>
      <li>SCoT : <code>200040715_SCOT_20240101</code></li>
      <li>SUP (gestionnaire, catégorie, territoire, date) : <code>123456789_AC1_25349_20240101</code></li>
      <li>Mise en compatibilité : <code>25349_PLU_MEC1_20240101</code></li>
    </ul>
    <div data-id="model-row" hidden>
      <label for="gen-model">Millésime du standard</label>
      <select id="gen-model"></select>
    </div>
    <label class="check"><input data-id="optional" type="checkbox" /> Inclure les entrées facultatives</label>
    <button data-id="go" type="submit" disabled>Générer l’archive</button>
  </form>
  <p data-id="status" role="status" aria-live="polite"></p>
  <p data-id="result" hidden><a data-id="download" href="#">Télécharger l’archive</a></p>`;

const base = `${import.meta.env.BASE_URL}config/`;
const source: ModelSource = {
  async text(path) {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`Modèle introuvable : ${path}`);
    return res.text();
  },
};

export function mount(container: HTMLElement) {
  container.innerHTML = html;
  const $ = <T extends HTMLElement>(id: string) =>
    container.querySelector(`[data-id="${id}"]`) as T;
  const name = container.querySelector<HTMLInputElement>('#gen-name')!;
  const model = container.querySelector<HTMLSelectElement>('#gen-model')!;
  const modelRow = $('model-row');
  const optional = $<HTMLInputElement>('optional');
  const go = $<HTMLButtonElement>('go');
  const result = $('result');
  const download = $<HTMLAnchorElement>('download');
  const setStatus = statusLine($('status'));

  let index: ModelIndexEntry[] = [];
  let downloadUrl: string | undefined;

  function refresh() {
    result.hidden = true;
    const value = name.value.trim();
    const found = value ? matchModels(index, value) : [];
    model.replaceChildren(
      ...found.map((m, i) => {
        const o = document.createElement('option');
        o.value = m.name;
        o.textContent = m.name;
        o.selected = i === found.length - 1; // dernier millésime présélectionné
        return o;
      }),
    );
    modelRow.hidden = found.length < 2;
    go.disabled = found.length === 0;
    if (value && found.length === 0) {
      setStatus(
        'Ce nom ne correspond à aucun standard (PLU, PLUi, POS, CC, PSMV, SCoT, SUP ou MEC).',
        true,
      );
    } else setStatus('');
  }

  name.addEventListener('input', refresh);

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const folder = name.value.trim();
    go.disabled = true;
    result.hidden = true;
    try {
      setStatus('Récupération des géométries et génération en cours…');
      const doc = await generateDocument({
        folder,
        modelName: model.value,
        includeOptional: optional.checked,
        source,
        fetchFn: (u) => fetch(u),
      });
      const zip = await zipDocument(doc);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = blobLink(
        download,
        new Blob([zip as BlobPart], { type: 'application/zip' }),
        `${folder}.zip`,
      );
      download.textContent = `Télécharger ${folder}.zip (${doc.files.size} fichiers)`;
      result.hidden = false;
      setStatus('Archive prête.');
      download.click();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      go.disabled = false;
    }
  });

  loadIndex(source)
    .then((i) => {
      index = i;
      refresh();
    })
    .catch(() => setStatus('Impossible de charger les modèles.', true));
}
