import type { DocInfo } from './regex';

/** Dates des standards CNIG (cf. gpu-site, CnigStandardDates). */
const STANDARD_DATES: Record<string, string> = {
  '2013': '2013-04-19',
  '2014': '2014-10-02',
  '2017': '2017-12-14',
  '2019': '2019-09-17',
  '2016': '2016-12-14',
  '2018': '2018-04-12',
  '2021': '2021-04-02',
  '2022': '2022-11-10',
  '2024': '2023-12-14',
  '2025': '2025-01-30',
};

export interface MetadataInput {
  info: DocInfo;
  /** nom du modèle, ex. cnig_PLU_2024 */
  modelName: string;
  /** emprise [ouest, sud, est, nord] */
  bbox: [number, number, number, number];
  /** intitulé de la spécification (constraints.metadataSpecification du modèle), ex. « CNIG SUP v2016 » */
  spec?: string;
  /** libellé du territoire */
  territory: string;
  /** date du jour YYYY-MM-DD (injectable pour les tests) */
  today: string;
}

const x = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cs = (v: string) => `<gco:CharacterString>${x(v)}</gco:CharacterString>`;
const codeValue = (tag: string, list: string, v: string) =>
  `<gmd:${tag} codeList="http://www.isotc211.org/2005/resources/Codelist/gmxCodelists.xml#${list}" codeListValue="${v}">${v}</gmd:${tag}>`;

const iso = (d: string, today: string) =>
  /^0+$/.test(d) ? today : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

function contact(role: string) {
  return `<gmd:CI_ResponsibleParty>
        <gmd:organisationName>${cs('Organisation de test')}</gmd:organisationName>
        <gmd:contactInfo><gmd:CI_Contact><gmd:address><gmd:CI_Address>
          <gmd:electronicMailAddress>${cs('test@example.org')}</gmd:electronicMailAddress>
        </gmd:CI_Address></gmd:address></gmd:CI_Contact></gmd:contactInfo>
        <gmd:role>${codeValue('CI_RoleCode', 'CI_RoleCode', role)}</gmd:role>
      </gmd:CI_ResponsibleParty>`;
}

function citationDate(d: string, type: string) {
  return `<gmd:date><gmd:CI_Date>
          <gmd:date><gco:Date>${d}</gco:Date></gmd:date>
          <gmd:dateType>${codeValue('CI_DateTypeCode', 'CI_DateTypeCode', type)}</gmd:dateType>
        </gmd:CI_Date></gmd:date>`;
}

/** Fiche de métadonnées ISO 19115 minimale, adaptée du gabarit de gpu-site (templates/metadata/metadata.xml.twig). */
export function buildMetadata(m: MetadataInput): string {
  const parts = m.modelName.split('_');
  const [, type] = parts;
  const year = parts[parts.length - 1];
  const spec = m.spec ?? `CNIG ${type} v${year}`;
  const specDate = STANDARD_DATES[year] ?? '2014-10-02';
  const revision = iso(m.info.date, m.today);
  const title = `${type} ${m.territory} - document de test`;
  const [w, s, e, n] = m.bbox;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gmd:MD_Metadata xmlns:gmd="http://www.isotc211.org/2005/gmd"
    xmlns:gco="http://www.isotc211.org/2005/gco"
    xmlns:gmx="http://www.isotc211.org/2005/gmx"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <gmd:fileIdentifier>${cs(m.info.folder)}</gmd:fileIdentifier>
  <gmd:language><gmd:LanguageCode codeList="http://www.loc.gov/standards/iso639-2/" codeListValue="fre">fre</gmd:LanguageCode></gmd:language>
  <gmd:hierarchyLevel>${codeValue('MD_ScopeCode', 'MD_ScopeCode', 'dataset')}</gmd:hierarchyLevel>
  <gmd:contact>${contact('pointOfContact')}</gmd:contact>
  <gmd:dateStamp><gco:DateTime>${m.today}T00:00:00</gco:DateTime></gmd:dateStamp>
  <gmd:referenceSystemInfo><gmd:MD_ReferenceSystem><gmd:referenceSystemIdentifier><gmd:RS_Identifier>
    <gmd:code><gmx:Anchor xlink:href="http://www.opengis.net/def/crs/EPSG/0/4326">EPSG:4326</gmx:Anchor></gmd:code>
  </gmd:RS_Identifier></gmd:referenceSystemIdentifier></gmd:MD_ReferenceSystem></gmd:referenceSystemInfo>
  <gmd:identificationInfo><gmd:MD_DataIdentification>
    <gmd:citation><gmd:CI_Citation>
      <gmd:title>${cs(title)}</gmd:title>
      ${citationDate(m.today, 'creation')}
      ${citationDate(m.today, 'publication')}
      ${citationDate(revision, 'revision')}
      <gmd:identifier><gmd:MD_Identifier><gmd:code>${cs(`https://www.geoportail-urbanisme.gouv.fr/${m.info.folder}`)}</gmd:code></gmd:MD_Identifier></gmd:identifier>
    </gmd:CI_Citation></gmd:citation>
    <gmd:abstract>${cs(`Document d'urbanisme factice ${m.info.folder}, généré pour des tests (ceci est un doc de test).`)}</gmd:abstract>
    <gmd:pointOfContact>${contact('owner')}</gmd:pointOfContact>
    <gmd:resourceConstraints><gmd:MD_LegalConstraints>
      <gmd:accessConstraints><gmd:MD_RestrictionCode codeList="http://standards.iso.org/ittf/PubliclyAvailableStandards/ISO_19139_Schemas/resources/Codelist/gmxCodelists.xml#MD_RestrictionCode" codeListValue="otherRestrictions">otherRestrictions</gmd:MD_RestrictionCode></gmd:accessConstraints>
      <gmd:otherConstraints><gmx:Anchor xlink:href="http://inspire.ec.europa.eu/metadata-codelist/LimitationsOnPublicAccess/noLimitations">Pas de restriction d’accès public</gmx:Anchor></gmd:otherConstraints>
    </gmd:MD_LegalConstraints></gmd:resourceConstraints>
    <gmd:resourceConstraints><gmd:MD_LegalConstraints>
      <gmd:accessConstraints><gmd:MD_RestrictionCode codeList="http://standards.iso.org/ittf/PubliclyAvailableStandards/ISO_19139_Schemas/resources/Codelist/gmxCodelists.xml#MD_RestrictionCode" codeListValue="otherRestrictions">otherRestrictions</gmd:MD_RestrictionCode></gmd:accessConstraints>
      <gmd:otherConstraints><gmx:Anchor xlink:href="http://inspire.ec.europa.eu/metadata-codelist/ConditionsApplyingToAccessAndUse/noConditionsApply">aucune condition d’accès ne s’applique.</gmx:Anchor></gmd:otherConstraints>
    </gmd:MD_LegalConstraints></gmd:resourceConstraints>
    <gmd:spatialRepresentationType>${codeValue('MD_SpatialRepresentationTypeCode', 'MD_SpatialRepresentationTypeCode', 'vector')}</gmd:spatialRepresentationType>
    <gmd:spatialResolution><gmd:MD_Resolution><gmd:equivalentScale><gmd:MD_RepresentativeFraction><gmd:denominator><gco:Integer>5000</gco:Integer></gmd:denominator></gmd:MD_RepresentativeFraction></gmd:equivalentScale></gmd:MD_Resolution></gmd:spatialResolution>
    <gmd:language><gmd:LanguageCode codeList="http://www.loc.gov/standards/iso639-2/" codeListValue="fre">fre</gmd:LanguageCode></gmd:language>
    <gmd:characterSet><gmd:MD_CharacterSetCode codeList="http://www.isotc211.org/2005/resources/codeList.xml#MD_CharacterSetCode" codeListValue="utf8">utf8</gmd:MD_CharacterSetCode></gmd:characterSet>
    <gmd:topicCategory><gmd:MD_TopicCategoryCode>planningCadastre</gmd:MD_TopicCategoryCode></gmd:topicCategory>
    <gmd:extent><gmd:EX_Extent><gmd:geographicElement><gmd:EX_GeographicBoundingBox>
      <gmd:westBoundLongitude><gco:Decimal>${w}</gco:Decimal></gmd:westBoundLongitude>
      <gmd:eastBoundLongitude><gco:Decimal>${e}</gco:Decimal></gmd:eastBoundLongitude>
      <gmd:southBoundLatitude><gco:Decimal>${s}</gco:Decimal></gmd:southBoundLatitude>
      <gmd:northBoundLatitude><gco:Decimal>${n}</gco:Decimal></gmd:northBoundLatitude>
    </gmd:EX_GeographicBoundingBox></gmd:geographicElement></gmd:EX_Extent></gmd:extent>
  </gmd:MD_DataIdentification></gmd:identificationInfo>
  <gmd:distributionInfo><gmd:MD_Distribution>
    <gmd:distributionFormat><gmd:MD_Format>
      <gmd:name>${cs('CSV')}</gmd:name><gmd:version>${cs('1.0')}</gmd:version>
      <gmd:specification>${cs('CSV v1.0')}</gmd:specification>
    </gmd:MD_Format></gmd:distributionFormat>
    <gmd:transferOptions><gmd:MD_DigitalTransferOptions><gmd:onLine><gmd:CI_OnlineResource>
      <gmd:linkage><gmd:URL>https://www.geoportail-urbanisme.gouv.fr/</gmd:URL></gmd:linkage>
      <gmd:protocol><gmx:Anchor xlink:href="https://inspire.ec.europa.eu/metadata-codelist/ProtocolValue">WWW:LINK-1.0-http--link</gmx:Anchor></gmd:protocol>
      <gmd:name>${cs('Géoportail de l’Urbanisme')}</gmd:name>
    </gmd:CI_OnlineResource></gmd:onLine></gmd:MD_DigitalTransferOptions></gmd:transferOptions>
  </gmd:MD_Distribution></gmd:distributionInfo>
  <gmd:dataQualityInfo><gmd:DQ_DataQuality>
    <gmd:scope><gmd:DQ_Scope><gmd:level>${codeValue('MD_ScopeCode', 'MD_ScopeCode', 'dataset')}</gmd:level></gmd:DQ_Scope></gmd:scope>
    <gmd:report><gmd:DQ_DomainConsistency><gmd:result><gmd:DQ_ConformanceResult>
      <gmd:specification><gmd:CI_Citation>
        <gmd:title>${cs(spec)}</gmd:title>
        ${citationDate(specDate, 'publication')}
      </gmd:CI_Citation></gmd:specification>
      <gmd:explanation>${cs(spec)}</gmd:explanation>
      <gmd:pass><gco:Boolean>true</gco:Boolean></gmd:pass>
    </gmd:DQ_ConformanceResult></gmd:result></gmd:DQ_DomainConsistency></gmd:report>
    <gmd:lineage><gmd:LI_Lineage><gmd:statement>${cs('Généalogie non renseignée')}</gmd:statement></gmd:LI_Lineage></gmd:lineage>
  </gmd:DQ_DataQuality></gmd:dataQualityInfo>
</gmd:MD_Metadata>
`;
}
