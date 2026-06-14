#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CENSUS_DIR = path.join(REPO, "data", "census");
const OUT_DIR = path.join(CENSUS_DIR, "cleaned");
const BUNDLE_DIR = path.join(OUT_DIR, "website-bundles");

const CORE_DIMENSIONS = [
  { id: "age", label: "Age", operators: ["equals", "in", "range"], combinable: true },
  { id: "sex", label: "Sex", operators: ["equals"], combinable: true },
  { id: "religion", label: "Religion", operators: ["equals", "in"], combinable: true },
  { id: "community_background", label: "Community background", operators: ["equals", "in"], combinable: true },
  { id: "ethnicity", label: "Ethnicity", operators: ["equals", "in"], combinable: true },
  { id: "country_of_birth", label: "Country of birth", operators: ["equals", "in"], combinable: true },
  { id: "economic_activity", label: "Economic activity", operators: ["equals", "in"], combinable: true },
  { id: "qualification", label: "Qualification", operators: ["equals", "in"], combinable: true },
  { id: "health", label: "Health", operators: ["equals", "in"], combinable: true },
  { id: "disability", label: "Disability or limiting condition", operators: ["equals", "in"], combinable: true },
  { id: "tenure", label: "Tenure", operators: ["equals", "in"], combinable: true },
  { id: "household", label: "Household composition", operators: ["equals", "in"], combinable: true },
  { id: "language", label: "Language knowledge/use", operators: ["equals", "in"], combinable: true },
  { id: "travel_to_work", label: "Travel to work", operators: ["equals", "in"], combinable: true },
  { id: "geography", label: "Geography", operators: ["equals", "within", "intersects"], combinable: true },
  { id: "time", label: "Census year/date", operators: ["equals", "range"], combinable: true },
];

const TOPIC_HINTS = [
  ["community_background", /community background|religion brought up/i],
  ["religion", /religion|catholic|presbyterian|methodist|church of ireland/i],
  ["age_structure", /\bage\b|aged|age structure/i],
  ["sex", /\bsex\b|male|female/i],
  ["ethnicity", /ethnic|traveller|asian|black|white|mixed/i],
  ["country_of_birth", /birth|born|country/i],
  ["economic_activity", /economic|employment|unemployed|occupation|industry|work/i],
  ["qualification", /qualification|student|education/i],
  ["housing_tenure", /tenure|owner|rented|housing/i],
  ["car_availability", /car|van/i],
  ["travel_to_work", /travel|commut|work from home/i],
  ["health_disability", /health|disability|limiting|care/i],
  ["population_by_area", /population|usual residents|residence type/i],
  ["household", /household|dwelling|accommodation|family/i],
  ["language", /irish|ulster-scots|language/i],
];

function rel(file) {
  return path.relative(REPO, file).replace(/\\/g, "/");
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === "\"" && line[i + 1] === "\"") {
        cur += "\"";
        i++;
      } else if (ch === "\"") {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === "\"") {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function readCsvRows(file, maxRows = 20) {
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, maxRows);
  return lines.map(parseCsvLine);
}

async function walkFiles(root, predicate = () => true) {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && predicate(full)) {
        files.push(full);
      }
    }
  }
  await walk(root);
  return files;
}

function inferTopic(...values) {
  const text = values.filter(Boolean).join(" ");
  for (const [topic, re] of TOPIC_HINTS) {
    if (re.test(text)) return topic;
  }
  return "unclassified";
}

function inferDimensions(description) {
  const parts = String(description || "")
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const dimensions = new Set();
  for (const part of parts) {
    const topic = inferTopic(part);
    if (topic !== "unclassified") dimensions.add(topic);
  }
  return { parts, dimensions: [...dimensions] };
}

function inferGeographyLevel(file) {
  const pieces = rel(file).split("/");
  const parent = pieces.at(-2) || "";
  const stem = path.basename(file, path.extname(file));
  const haystack = `${parent} ${stem}`.toLowerCase();
  const map = [
    ["small_area", /\bsmall area|\bsa\b/],
    ["super_output_area", /\bsuper output|soa\b/],
    ["ward", /\bward|electoral ward/],
    ["data_zone", /\bdz\b|data zone/],
    ["super_data_zone", /\bsdz\b|super data zone/],
    ["dea", /\bdea\b|district electoral area/],
    ["lgd", /\blgd\b|district council|local government district/],
    ["assembly_area", /assembly/],
    ["constituency", /parliamentary|constituency/],
    ["settlement", /settlement/],
    ["country", /northern ireland|country/],
    ["nuts3", /nuts3|european/],
    ["education_board", /education|elb/],
    ["health_trust", /health|hsct/],
  ];
  return map.find(([, re]) => re.test(haystack))?.[0] || "unknown";
}

function extract2011TableId(file) {
  return path.basename(file).replace(/(?:META|DESC|DATA)0?\.CSV$/i, "").toUpperCase();
}

async function extract2011Tables() {
  const metaFiles = await walkFiles(path.join(CENSUS_DIR, "2011"), (file) => /META0?\.CSV$/i.test(file));
  const tables = [];
  for (const metaFile of metaFiles) {
    const id = extract2011TableId(metaFile);
    const rows = await readCsvRows(metaFile, 3);
    const header = rows[0] || [];
    const values = rows[1] || [];
    const meta = Object.fromEntries(header.map((key, index) => [key, values[index]]));
    const descFile = metaFile.replace(/META0?\.CSV$/i, "DESC0.CSV");
    const dataFile = metaFile.replace(/META0?\.CSV$/i, "DATA0.CSV");
    const descRows = await readCsvRows(descFile, 5000);
    const descHeader = descRows[0] || [];
    const descItems = descRows.slice(1).map((row) => Object.fromEntries(descHeader.map((key, index) => [key, row[index]])));
    const dimensionCounts = {};
    for (const item of descItems) {
      const inferred = inferDimensions(item.ColumnVariableDescription);
      for (const dimension of inferred.dimensions) {
        dimensionCounts[dimension] = (dimensionCounts[dimension] || 0) + 1;
      }
    }
    const dataHeader = (await readCsvRows(dataFile, 1))[0] || [];
    const topic = inferTopic(meta.DatasetTitle, meta.StatisticalPopulations, descItems[0]?.ColumnVariableDescription);
    tables.push({
      id,
      censusYear: 2011,
      sourceFamily: "nisra_2011_csv_triplet",
      title: meta.DatasetTitle || id,
      statisticalPopulation: meta.StatisticalPopulations || null,
      annotations: meta.Annotations || null,
      topic,
      geographyLevel: inferGeographyLevel(metaFile),
      files: {
        meta: rel(metaFile),
        desc: rel(descFile),
        data: rel(dataFile),
      },
      columns: Math.max(0, dataHeader.length - 1),
      variablesDescribed: descItems.length,
      dimensionCounts,
      sampleVariables: descItems.slice(0, 18).map((item) => ({
        code: item.ColumnVariableCode,
        unit: item.ColumnVariableMeasurementUnit,
        statisticalUnit: item.ColumnVariableStatisticalUnit,
        description: item.ColumnVariableDescription,
        dimensions: inferDimensions(item.ColumnVariableDescription).parts,
      })),
      mappingConfidence: topic === "unclassified" ? "low" : "medium",
    });
  }
  return tables.sort((a, b) => a.id.localeCompare(b.id) || a.geographyLevel.localeCompare(b.geographyLevel));
}

function derived2021Concept(file) {
  const stem = path.basename(file, ".csv");
  const match = stem.match(/^(ms-[a-z]\d+)(?:-(.*?))?-(lgd|ward|dea|dz|sdz|settlement)$/i);
  if (!match) return { tableId: stem, metric: null, geographyLevel: inferGeographyLevel(file) };
  const [, tableId, metric, geography] = match;
  return {
    tableId: tableId.toUpperCase(),
    metric: metric || null,
    geographyLevel: geography.toLowerCase(),
  };
}

async function extract2021DerivedTables() {
  const files = await walkFiles(path.join(CENSUS_DIR, "derived"), (file) => /\.csv$/i.test(file));
  const tables = [];
  for (const file of files) {
    const rows = await readCsvRows(file, 3);
    const header = rows[0] || [];
    const concept = derived2021Concept(file);
    const topic = inferTopic(concept.tableId, concept.metric, header.join(" "));
    tables.push({
      id: `${concept.tableId}:${concept.metric || "all"}:${concept.geographyLevel}`,
      censusYear: 2021,
      sourceFamily: "nisra_2021_derived_csv",
      title: path.basename(file, ".csv"),
      topic,
      geographyLevel: concept.geographyLevel,
      files: { data: rel(file) },
      columns: Math.max(0, header.length - 2),
      variablesDescribed: Math.max(0, header.length - 2),
      dimensionCounts: Object.fromEntries(inferDimensions(header.join(", ")).dimensions.map((dimension) => [dimension, 1])),
      sampleVariables: header.slice(2).map((name) => ({ code: name, description: name, dimensions: inferDimensions(name).parts })),
      mappingConfidence: topic === "unclassified" ? "low" : "high",
    });
  }
  return tables.sort((a, b) => a.id.localeCompare(b.id));
}

async function extractHistoricalMarkdownTables() {
  const files = await walkFiles(CENSUS_DIR, (file) => /census-\d{4}.*\.md$/i.test(path.basename(file)));
  return Promise.all(files.map(async (file) => {
    const text = await fs.readFile(file, "utf8");
    const year = Number(path.basename(file).match(/census-(\d{4})/)?.[1]);
    const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1]).slice(0, 80);
    return {
      id: `historical-ni-${year}-${path.basename(file, ".md")}`,
      censusYear: year,
      sourceFamily: "ocr_markdown_report",
      title: headings[0] || path.basename(file),
      topic: "historical_report",
      geographyLevel: year >= 1981 ? "lgd_or_ward_report" : "county_ded_townland_report",
      files: { markdown: rel(file) },
      pages: (text.match(/^## Page /gm) || []).length,
      headings,
      mappingConfidence: "low",
    };
  }));
}

function normaliseArchiveTitle(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/^census[-_\s]*/i, "Census ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function archiveMemberRecords(sourceInventory) {
  const tables = [];
  for (const archive of sourceInventory?.localArchives || []) {
    if (!archive.exists || !archive.zip) continue;
    const sourceBase = `local_archive_${archive.year}`;
    const archiveRef = archive.sourceHint || archive.file || `local_archive_${archive.year}`;
    const topFiles = archive.zip.fileIndex || [];
    for (const file of topFiles) {
      if (file.extension === "zip") continue;
      const topic = inferTopic(file.path);
      tables.push({
        id: `${sourceBase}:top:${file.path}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
        censusYear: archive.year,
        scope: archive.scope,
        sourceFamily: archive.kind,
        title: normaliseArchiveTitle(file.path),
        topic: topic === "unclassified" ? "source_document" : topic,
        geographyLevel: inferGeographyLevel(file.path),
        files: { archive: archiveRef, member: file.path },
        sourceFormat: file.extension,
        compressedBytes: file.compressedSize,
        uncompressedBytes: file.uncompressedSize,
        mappingConfidence: file.extension === "pdf" ? "low" : "medium",
      });
    }
    for (const nested of archive.zip.nestedArchives || []) {
      const nestedFiles = nested.fileIndex || [];
      for (const file of nestedFiles) {
        if (file.extension === "zip") continue;
        const memberPath = `${nested.path}::${file.path}`;
        const topic = inferTopic(memberPath);
        tables.push({
          id: `${sourceBase}:nested:${memberPath}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
          censusYear: archive.year,
          scope: archive.scope,
          sourceFamily: archive.kind,
          title: normaliseArchiveTitle(file.path),
          topic: topic === "unclassified" ? "source_table_or_report" : topic,
          geographyLevel: inferGeographyLevel(memberPath),
          files: { archive: archiveRef, nestedArchive: nested.path, member: file.path },
          sourceFormat: file.extension,
          compressedBytes: file.compressedSize,
          uncompressedBytes: file.uncompressedSize,
          mappingConfidence: file.extension === "pdf" ? "low" : "medium",
        });
      }
      for (const child of nested.nestedArchives || []) {
        for (const file of child.fileIndex || []) {
          if (file.extension === "zip") continue;
          const memberPath = `${nested.path}::${child.path}::${file.path}`;
          const topic = inferTopic(memberPath);
          tables.push({
            id: `${sourceBase}:nested2:${memberPath}`.replace(/[^A-Za-z0-9:_-]+/g, "_"),
            censusYear: archive.year,
            scope: archive.scope,
            sourceFamily: archive.kind,
            title: normaliseArchiveTitle(file.path),
            topic: topic === "unclassified" ? "source_table_or_report" : topic,
            geographyLevel: inferGeographyLevel(memberPath),
            files: { archive: archiveRef, nestedArchive: nested.path, childArchive: child.path, member: file.path },
            sourceFormat: file.extension,
            compressedBytes: file.compressedSize,
            uncompressedBytes: file.uncompressedSize,
            mappingConfidence: file.extension === "pdf" ? "low" : "medium",
          });
        }
      }
    }
  }
  return tables;
}

function buildCanonicalGeographies(schema) {
  const geographies = [];
  const units = schema?.geographic_units || {};
  for (const [period, value] of Object.entries(units)) {
    const levels = [
      ...(value.levels || []),
      ...(value.levels_administrative || []),
      ...(value.levels_statistical || []),
    ];
    for (const level of levels) {
      geographies.push({
        id: `${period}:${String(level.name || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        period,
        name: level.name,
        count: level.count ?? null,
        codeFormat: level.code_format ?? null,
        example: level.example ?? null,
        description: level.description ?? null,
        system: value.system,
        notes: value.notes ?? null,
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    policy: "Canonical geography entries identify native source geographies first. Cross-year comparability is recorded separately so incompatible geographies are not silently treated as equivalent.",
    geographies,
    crosswalksNeeded: schema?.geographic_crosswalks_needed || {},
  };
}

function buildConceptOntology(normalisationPlan) {
  const priorities = normalisationPlan?.normalisation_priorities || [];
  return {
    generatedAt: new Date().toISOString(),
    model: {
      expressionLanguage: "criteria can be combined with AND/OR; each criterion must resolve to a source table whose dimensions include the requested concept/value",
      unavailableCombinationPolicy: "return an explicit unavailable state with nearest available table suggestions, not a zero or blank value",
    },
    dimensions: CORE_DIMENSIONS,
    concepts: priorities.map((item) => ({
      id: item.topic,
      priority: item.priority,
      label: item.description,
      yearsAvailableDigital: item.years_available_digital || [],
      yearsAvailableHistorical: item.years_available_historical || [],
      sourceTables: item.source_tables || {},
      normalisedColumns: item.normalised_columns || [],
      comparabilityNotes: item.comparability_notes || item.normalisation_approach || null,
      difficulty: item.difficulty || null,
    })),
  };
}

function buildColumnMappings(tables) {
  return {
    generatedAt: new Date().toISOString(),
    mappingPolicy: "2011 DESC rows are treated as authoritative variable metadata. 2021 derived CSVs inherit the curated extraction manifest. Older reports require manual/OCR table extraction before high-confidence cell-level mappings.",
    tables: tables.map((table) => ({
      id: table.id,
      year: table.censusYear,
      sourceFamily: table.sourceFamily,
      topic: table.topic,
      geographyLevel: table.geographyLevel,
      columns: table.columns ?? table.variablesDescribed ?? null,
      dimensionCounts: table.dimensionCounts || {},
      sampleVariables: table.sampleVariables || [],
      confidence: table.mappingConfidence,
    })),
  };
}

function buildComparability(normalisationPlan, schema) {
  return {
    generatedAt: new Date().toISOString(),
    crossCensusColumnMappings: schema?.cross_census_column_mappings || {},
    geographyCrosswalks: normalisationPlan?.geographic_crosswalks || {},
    conceptGroups: (normalisationPlan?.normalisation_priorities || []).map((item) => ({
      topic: item.topic,
      exactComparableYears: item.years_available_digital || [],
      historicalYears: item.years_available_historical || [],
      comparableNativeLevels: item.geographic_levels_feasible || null,
      notes: item.comparability_notes || item.normalisation_approach || null,
      risk: item.difficulty === "easy" ? "low" : item.difficulty === "moderate" ? "medium" : "high",
    })),
    specialCases: [
      {
        topic: "religion",
        issue: "2001 combines no religion and not stated differently from 2011/2021 in some tables.",
        action: "Expose both source-native and harmonised variants; mark harmonised values as partial comparability.",
      },
      {
        topic: "travel_to_work",
        issue: "2021 travel/work-from-home values are affected by COVID-19 patterns.",
        action: "Permit display but annotate any time-series comparison.",
      },
      {
        topic: "ward_time_series",
        issue: "2001/2011 wards and 2021 wards are different boundary systems.",
        action: "Require a best-fit or spatial crosswalk before enabling direct ward-level comparisons.",
      },
    ],
  };
}

function buildAvailabilityGraph(tables, ontology) {
  const concepts = {};
  for (const concept of ontology.concepts) {
    concepts[concept.id] = { years: {}, geographyLevels: {}, tables: [] };
  }
  for (const table of tables) {
    const topic = table.topic || "unclassified";
    if (!concepts[topic]) concepts[topic] = { years: {}, geographyLevels: {}, tables: [] };
    concepts[topic].years[table.censusYear] = (concepts[topic].years[table.censusYear] || 0) + 1;
    concepts[topic].geographyLevels[table.geographyLevel || "unknown"] = (concepts[topic].geographyLevels[table.geographyLevel || "unknown"] || 0) + 1;
    concepts[topic].tables.push(table.id);
  }
  return {
    generatedAt: new Date().toISOString(),
    queryModel: {
      supportsAnd: true,
      supportsOr: true,
      supportsNestedBooleanGroups: true,
      caveat: "Nested logic can only be evaluated where one source table or a documented derived table contains all requested dimensions. The graph exposes availability; it does not imply arbitrary microdata reconstruction.",
    },
    concepts,
  };
}

function buildValidationReport({ tables, sourceInventory, csoManifest, normalisationPlan }) {
  const expected2011 = normalisationPlan?.data_overview?.total_csv_files_2011;
  const repo2011Csv = sourceInventory?.repoCensus?.byTopDirectory
    ? Object.entries(sourceInventory.repoCensus.byTopDirectory)
        .filter(([key]) => key.startsWith("data/census/2011"))
        .reduce((sum, [, count]) => sum + count, 0)
    : null;
  const localMissing = (sourceInventory?.localArchives || []).filter((archive) => !archive.exists);
  const failedCsoAssets = (csoManifest?.assets || []).filter((asset) => asset.download?.status === "failed");
  const lowConfidence = tables.filter((table) => table.mappingConfidence === "low");
  const warnings = [];
  if (localMissing.length) warnings.push(`${localMissing.length} local source archives are missing.`);
  if (failedCsoAssets.length) warnings.push(`${failedCsoAssets.length} CSO assets failed to download.`);
  if (repo2011Csv && expected2011 && repo2011Csv < expected2011) warnings.push(`Repo 2011 CSV inventory appears below expected count (${repo2011Csv} vs ${expected2011}).`);
  if (lowConfidence.length) warnings.push(`${lowConfidence.length} tables/reports have low-confidence automatic mappings.`);
  return {
    generatedAt: new Date().toISOString(),
    status: warnings.length ? "warnings" : "ok",
    summary: {
      tables: tables.length,
      lowConfidenceMappings: lowConfidence.length,
      localArchivesMissing: localMissing.length,
      csoAssetsFailed: failedCsoAssets.length,
      csoAssetsFound: csoManifest?.assetsFound ?? null,
      csoAssetsDownloadedOrCached: (csoManifest?.assetsDownloaded || 0) + (csoManifest?.assetsCached || 0),
    },
    warnings,
    checks: {
      localArchives: (sourceInventory?.localArchives || []).map((archive) => ({
        source: archive.sourceHint || archive.file || null,
        exists: archive.exists,
        year: archive.year,
        files: archive.zip?.files ?? null,
        error: archive.error,
      })),
      lowConfidenceSamples: lowConfidence.slice(0, 80).map((table) => ({ id: table.id, year: table.censusYear, title: table.title, sourceFamily: table.sourceFamily })),
      failedCsoAssets: failedCsoAssets.map((asset) => ({ url: asset.url, error: asset.download?.error })),
    },
  };
}

async function writeCsv(file, rows) {
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${rows.map((row) => row.map(escape).join(",")).join("\n")}\n`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(BUNDLE_DIR, { recursive: true });
  const schema = await readJson(path.join(CENSUS_DIR, "schema_mapping.json"), {});
  const normalisationPlan = await readJson(path.join(CENSUS_DIR, "normalisation_plan.json"), {});
  const sourceInventory = await readJson(path.join(CENSUS_DIR, "source-inventory", "census-source-archives.json"), {});
  const csoManifest = await readJson(path.join(CENSUS_DIR, "source-inventory", "cso-historical-reports.json"), {});

  const tables = [
    ...(await extract2011Tables()),
    ...(await extract2021DerivedTables()),
    ...(await extractHistoricalMarkdownTables()),
    ...archiveMemberRecords(sourceInventory),
  ];

  const geographies = buildCanonicalGeographies(schema);
  const ontology = buildConceptOntology(normalisationPlan);
  const mappings = buildColumnMappings(tables);
  const comparability = buildComparability(normalisationPlan, schema);
  const availability = buildAvailabilityGraph(tables, ontology);
  const validation = buildValidationReport({ tables, sourceInventory, csoManifest, normalisationPlan });
  const tableMetadata = {
    generatedAt: new Date().toISOString(),
    summary: {
      tables: tables.length,
      bySourceFamily: countBy(tables, (table) => table.sourceFamily),
      byCensusYear: countBy(tables, (table) => String(table.censusYear || "unknown")),
      byTopic: countBy(tables, (table) => table.topic),
      byGeographyLevel: countBy(tables, (table) => table.geographyLevel),
    },
    tables,
  };
  const bundle = {
    generatedAt: new Date().toISOString(),
    geographies: geographies.geographies,
    concepts: ontology.concepts,
    tableCount: tables.length,
    tableIndex: tables.map((table) => ({
      id: table.id,
      year: table.censusYear,
      title: table.title,
      topic: table.topic,
      geographyLevel: table.geographyLevel,
      confidence: table.mappingConfidence,
      files: table.files,
    })),
    availability: availability.concepts,
    validation: validation.summary,
  };

  await writeJson(path.join(OUT_DIR, "canonical-geographies.json"), geographies);
  await writeJson(path.join(OUT_DIR, "concept-ontology.json"), ontology);
  await writeJson(path.join(OUT_DIR, "table-metadata.json"), tableMetadata);
  await writeJson(path.join(OUT_DIR, "column-mappings.json"), mappings);
  await writeJson(path.join(OUT_DIR, "comparability-groups.json"), comparability);
  await writeJson(path.join(OUT_DIR, "availability-graph.json"), availability);
  await writeJson(path.join(OUT_DIR, "validation-report.json"), validation);
  await writeJson(path.join(BUNDLE_DIR, "catalogue.json"), bundle);
  await writeCsv(path.join(BUNDLE_DIR, "table-index.csv"), [
    ["id", "year", "topic", "geography_level", "confidence", "title"],
    ...tables.map((table) => [table.id, table.censusYear, table.topic, table.geographyLevel, table.mappingConfidence, table.title]),
  ]);

  console.log(`Census cleaning model generated in ${rel(OUT_DIR)}`);
  console.log(`Tables indexed: ${tables.length}`);
  console.log(`Validation status: ${validation.status}`);
  if (validation.warnings.length) {
    for (const warning of validation.warnings) console.log(`WARN: ${warning}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
