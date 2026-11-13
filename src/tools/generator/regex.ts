import RandExp from 'randexp';

export type DocKind = 'urba' | 'scot' | 'sup' | 'mec';

export interface DocInfo {
  /** nom du dossier du document, ex. 25349_PLU_20240101 */
  folder: string;
  kind: DocKind;
  /** code du territoire : INSEE (5 car.), SIREN (9 chiffres), département, région ou FR */
  code: string;
  /** famille : PLU, PLUi, POS, CC, PSMV, SCOT (SUP : catégorie ; MEC : famille du document modifié) */
  family: string;
  /** date du document YYYYMMDD */
  date: string;
  /** suffixe facultatif, ex. "_a" */
  suffix: string;
  /** SUP : catégorie (AC1, PM1bis...) */
  category?: string;
  /** SUP : identifiant du gestionnaire (SIREN, 9 chiffres) */
  idgest?: string;
  /** MEC : numéro de la mise en compatibilité */
  mec?: string;
}

const TERRITORY = '(FR|RR?[0-9]{2}|0?2[AB]|[0-9]{2,3}|(2A|2B|[0-9]{2})[0-9]{3}|[0-9]{9})';

export function parseFolder(folder: string): DocInfo {
  let m = /^(\d{9})_([A-Za-z]{1,3}\d{1,2}(?:bis)?)_([A-Z0-9]{2,9})_(\d{8})$/.exec(folder);
  if (m) {
    return {
      folder,
      kind: 'sup',
      code: m[3],
      family: m[2],
      category: m[2],
      idgest: m[1],
      date: m[4],
      suffix: '',
    };
  }
  m = new RegExp(`^${TERRITORY}_(PLU|POS|CC|PLUi|SCoT)_MEC(\\d+)_(\\d{8})$`).exec(folder);
  if (m)
    return { folder, kind: 'mec', code: m[1], family: m[3], date: m[5], suffix: '', mec: m[4] };
  m = /^([A-Z0-9]+)_([A-Za-z]+)_(\d{8})(_[a-zA-Z])?$/.exec(folder);
  if (!m) throw new Error(`Nom de document invalide : ${folder}`);
  return {
    folder,
    kind: m[2] === 'SCOT' ? 'scot' : 'urba',
    code: m[1],
    family: m[2],
    date: m[3],
    suffix: m[4] ?? '',
  };
}

const DATE = '([0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])|00000000)';
const MILLESIME = '([0-9]{4}((0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])|0000))';
const CODES = ['(\\d{9}|(2A|2B|\\d{2})\\d{3})', '[AB0-9]{5}', '[0-9]{9}'];
const SUFFIX = '(_[a-zA-Z])?';
const CATEGORY = '[A-Za-z]{1,3}[0-9]{1,2}(bis)?';

/** Remplace les motifs connus (code, date, suffixe) par la valeur du document. */
export function substitute(pattern: string, info: DocInfo): string {
  let p = pattern.split(DATE).join(info.date).split(MILLESIME).join(info.date);
  if (info.kind === 'sup') {
    p = p.split(TERRITORY).join(info.code).split(CATEGORY).join(info.category!);
  } else {
    p = p.split(TERRITORY).join(info.code);
    for (const c of CODES) p = p.split(c).join(info.code);
  }
  if (info.mec) p = p.split('MEC[0-9]+').join(`MEC${info.mec}`);
  return p.split(SUFFIX).join(info.suffix);
}

export function fullMatch(pattern: string, value: string): boolean {
  return new RegExp(`^(?:${pattern})$`).test(value);
}

/** Génération déterministe : toujours le plus petit choix (1re branche, répétitions minimales). */
export function generateMinimal(pattern: string): string {
  const r = new RandExp(pattern);
  r.randInt = (min: number) => min;
  return r.gen();
}

/** Génère une valeur conforme au motif, après substitution code/date/suffixe. */
export function generateFromPattern(pattern: string, info: DocInfo): string {
  const value = generateMinimal(substitute(pattern, info));
  if (!fullMatch(pattern, value)) {
    throw new Error(`Valeur générée « ${value} » non conforme à ${pattern}`);
  }
  return value;
}
