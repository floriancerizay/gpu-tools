import { formatSize, statusLine } from '../../ui';
import {
  loadIndex,
  matchModels,
  type FileEntry,
  type ModelIndexEntry,
  type ModelSource,
} from '../generator/model';
import { basename, DocArchive } from './archive';
import { checkNaming, loadEntries } from './naming';

const html = `
  <h2>Correcteur d’archive</h2>
  <p class="lead">Dépose une archive de document : change sa date (DATAPPRO) ou son code territoire (INSEE, SIREN) dans tout le
    document, et ajoute, renomme, déplace ou supprime des fichiers. Les fichiers mal nommés sont signalés en rouge. Les tables
    (.dbf, .csv) ne sont modifiées que sur les lignes du document ; les géométries (.shp, .shx, .prj, WKT) et les PDF ne sont jamais modifiés.</p>
  <label class="drop" data-id="drop">
    <input data-id="file" type="file" accept=".zip,application/zip">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
    <strong>Glissez une archive .zip ici</strong>
    <span>ou cliquez pour la choisir</span>
  </label>
  <p data-id="status" role="status" aria-live="polite"></p>
  <section data-id="work" hidden>
    <h3 data-id="title"></h3>
    <p data-id="summary" class="hint"></p>
    <div data-id="model-row" hidden>
      <label for="fix-model">Standard de référence</label>
      <select id="fix-model"></select>
    </div>
    <form data-id="retarget" class="inline" novalidate>
      <div><label for="fix-code">Code territoire</label><input id="fix-code" type="text" autocomplete="off" spellcheck="false"></div>
      <div><label for="fix-date">Date (AAAAMMJJ)</label><input id="fix-date" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="8"></div>
      <button type="submit">Appliquer</button>
    </form>
    <p class="actions"><button data-id="download" type="button">Télécharger l’archive</button></p>
    <ul class="tree" data-id="tree"></ul>
  </section>
  <dialog data-id="dlg"><form method="dialog" data-id="dlg-form">
    <label data-id="dlg-label" for="fix-dlg-input"></label>
    <input id="fix-dlg-input" type="text" autocomplete="off" spellcheck="false">
    <p class="actions"><button value="ok">Valider</button> <button value="cancel" type="button" data-id="dlg-cancel" class="secondary">Annuler</button></p>
  </form></dialog>`;

const base = `${import.meta.env.BASE_URL}config/`;
const source: ModelSource = {
  async text(path) {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`Modèle introuvable : ${path}`);
    return res.text();
  },
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function mount(container: HTMLElement) {
  container.innerHTML = html;
  const $ = <T extends HTMLElement>(id: string) =>
    container.querySelector(`[data-id="${id}"]`) as T;
  const q = <T extends HTMLElement>(sel: string) => container.querySelector(sel) as T;
  const setStatus = statusLine($('status'));
  const work = $('work');
  const tree = $('tree');
  const code = q<HTMLInputElement>('#fix-code');
  const date = q<HTMLInputElement>('#fix-date');
  const modelSel = q<HTMLSelectElement>('#fix-model');
  const dlg = $<HTMLDialogElement>('dlg');
  const dlgInput = q<HTMLInputElement>('#fix-dlg-input');

  let doc: DocArchive | undefined;
  let index: ModelIndexEntry[] = [];
  let entries: FileEntry[] = [];
  let sourceName = 'archive';
  loadIndex(source)
    .then((i) => {
      index = i;
    })
    .catch(() => {
      /* standards indisponibles : pas de contrôle des noms */
    });

  /** Boîte de saisie ; renvoie null si annulée. */
  function ask(label: string, value = ''): Promise<string | null> {
    $('dlg-label').textContent = label;
    dlgInput.value = value;
    return new Promise((resolve) => {
      const done = (v: string | null) => {
        dlg.close();
        dlg.onclose = null;
        resolve(v);
      };
      $<HTMLFormElement>('dlg-form').onsubmit = (e) => {
        e.preventDefault();
        done(dlgInput.value.trim() || null);
      };
      $('dlg-cancel').onclick = () => done(null);
      dlg.oncancel = () => resolve(null);
      dlg.showModal();
      dlgInput.select();
    });
  }

  const save = (name: string, bytes: Uint8Array, type: string) => {
    const a = el('a');
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  async function refreshModels() {
    if (!doc) return;
    const found = matchModels(index, doc.folder);
    modelSel.replaceChildren(
      ...found.map((m, i) => {
        const o = el('option', '', m.name);
        o.value = m.name;
        o.selected = i === found.length - 1;
        return o;
      }),
    );
    $('model-row').hidden = found.length < 2;
    entries = found.length ? await loadEntries(source, modelSel.value).catch(() => []) : [];
  }

  function render() {
    if (!doc) return;
    const d = doc;
    const ok = entries.length ? checkNaming(d, entries) : new Map<string, boolean>();
    const bad = [...ok.values()].filter((v) => !v).length;
    $('title').textContent = d.folder;
    $('summary').textContent = entries.length
      ? `${d.files.size} fichier(s), ${bad} nom(s) non conforme(s) au standard ${modelSel.value}.`
      : `${d.files.size} fichier(s). Aucun standard ne correspond à ce nom : les noms ne sont pas contrôlés.`;
    code.value = d.info.code;
    date.value = d.info.date;

    const dirsByParent = new Map<string, string[]>();
    const filesByDir = new Map<string, string[]>();
    const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    for (const p of [...d.dirs].sort())
      dirsByParent.set(parent(p), [...(dirsByParent.get(parent(p)) ?? []), p]);
    for (const p of [...d.files.keys()].sort())
      filesByDir.set(parent(p), [...(filesByDir.get(parent(p)) ?? []), p]);

    const badge = (path: string, kind: string) => {
      if (!entries.length || ok.get(path) !== false) return null;
      const w = el('span', 'warn', '!');
      w.setAttribute('role', 'img');
      w.setAttribute('aria-label', `${kind} non conforme au standard`);
      w.title = `${kind} non conforme au standard`;
      return w;
    };
    const action = (label: string, fn: () => void | Promise<void>) => {
      const b = el('button', 'link', label);
      b.type = 'button';
      b.addEventListener('click', async () => {
        try {
          await fn();
          setStatus('');
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e), true);
        }
        render();
      });
      return b;
    };

    const list = (dir: string): HTMLElement[] => {
      const items: HTMLElement[] = [];
      for (const sub of dirsByParent.get(dir) ?? []) {
        const li = el('li', ok.get(sub) === false && entries.length ? 'dir bad' : 'dir');
        const det = el('details');
        det.open = true;
        const sum = el('summary');
        const w = badge(sub, 'Dossier');
        if (w) sum.append(w);
        sum.append(el('span', 'name', basename(sub)));
        sum.append(
          action('Ajouter un fichier', async () => {
            const inp = el('input');
            inp.type = 'file';
            inp.multiple = true;
            const files = await new Promise<File[]>((res) => {
              inp.onchange = () => res([...inp.files!]);
              inp.oncancel = () => res([]);
              inp.click();
            });
            for (const f of files)
              d.addFile(`${sub}/${f.name}`, new Uint8Array(await f.arrayBuffer()));
          }),
          action('Ajouter un dossier', async () => {
            const n = await ask(`Nom du nouveau dossier dans ${sub}`);
            if (n) d.addDir(`${sub}/${n}`);
          }),
          action('Renommer / déplacer', async () => {
            const n = await ask('Nouveau chemin du dossier', sub);
            if (n && n !== sub) d.renameDir(sub, n);
          }),
          action('Supprimer', () => {
            if (confirm(`Supprimer le dossier ${sub} et son contenu ?`)) d.removeDir(sub);
          }),
        );
        det.append(sum, el('ul', 'tree', ''));
        (det.lastChild as HTMLElement).append(...list(sub));
        li.append(det);
        items.push(li);
      }
      for (const f of filesByDir.get(dir) ?? []) {
        const li = el('li', ok.get(f) === false && entries.length ? 'file bad' : 'file');
        const w = badge(f, 'Fichier');
        if (w) li.append(w);
        li.append(
          el('span', 'name', basename(f)),
          el('span', 'size', formatSize(d.files.get(f)!.length)),
        );
        li.append(
          action('Télécharger', () =>
            save(basename(f), d.files.get(f)!, 'application/octet-stream'),
          ),
          action('Renommer / déplacer', async () => {
            const n = await ask('Nouveau chemin du fichier', f);
            if (!n || n === f) return;
            const refs = d.renameFile(f, n);
            if (refs) setStatus(`${refs} référence(s) mise(s) à jour dans les tables.`);
          }),
          action('Supprimer', () => {
            if (confirm(`Supprimer ${f} ?`)) d.removeFile(f);
          }),
        );
        items.push(li);
      }
      return items;
    };

    const rootActions = el('li', 'dir root');
    rootActions.append(
      action('Ajouter un fichier à la racine', async () => {
        const inp = el('input');
        inp.type = 'file';
        const files = await new Promise<File[]>((res) => {
          inp.onchange = () => res([...inp.files!]);
          inp.oncancel = () => res([]);
          inp.click();
        });
        for (const f of files) d.addFile(f.name, new Uint8Array(await f.arrayBuffer()));
      }),
      action('Ajouter un dossier', async () => {
        const n = await ask('Nom du nouveau dossier');
        if (n) d.addDir(n);
      }),
    );
    tree.replaceChildren(...list(''), rootActions);
  }

  async function open(f: File | undefined) {
    if (!f) return;
    try {
      doc = await DocArchive.load(f);
      sourceName = f.name;
      await refreshModels();
      work.hidden = false;
      setStatus('');
      render();
    } catch (e) {
      doc = undefined;
      work.hidden = true;
      setStatus(e instanceof Error ? e.message : String(e), true);
    }
  }

  modelSel.addEventListener('change', async () => {
    entries = await loadEntries(source, modelSel.value).catch(() => []);
    render();
  });

  $('retarget').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!doc) return;
    try {
      const r = doc.retarget({ code: code.value, date: date.value, models: index });
      await refreshModels();
      setStatus(
        `${r.renamedFiles} fichier(s) renommé(s), ${r.changedCells} cellule(s) et ${r.changedXml} fiche(s) XML modifiée(s).${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`,
      );
      render();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), true);
    }
  });

  $('download').addEventListener('click', async () => {
    if (!doc) return;
    save(`${doc.folder}.zip`, await doc.toZip(), 'application/zip');
    setStatus(`Archive téléchargée (modifiée à partir de ${sourceName}).`);
  });

  const input = $<HTMLInputElement>('file');
  const drop = $('drop');
  input.addEventListener('change', () => open(input.files?.[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    open([...e.dataTransfer!.files].find((f) => /\.zip$/i.test(f.name)));
  });
}
