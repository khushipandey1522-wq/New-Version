import * as XLSX from "xlsx";
import type { Stage1Output, ISQ, AuditResult, UploadedSpec } from "../types";

interface CommonSpecItem {
  spec_name: string;
  options: string[];
  input_type: string;
  category: "Primary" | "Secondary";
}

interface BuyerISQItem {
  spec_name: string;
  options: string[];
  category: "Primary" | "Secondary";
}

export function generateAuditExcel(
  mcatName: string,
  auditResults: AuditResult[],
  originalSpecs: UploadedSpec[]
) {
  const workbook = XLSX.utils.book_new();

  const auditData: unknown[] = auditResults.map((result) => {
    const spec = originalSpecs.find((s) => s.spec_name === result.specification);
    return {
      "Specification Name": result.specification,
      "Status": result.status === "correct" ? "CORRECT" : "INCORRECT",
      "Tier": spec?.tier || "N/A",
      "Input Type": spec?.input_type || "N/A",
      "Options (Comma Separated)": spec?.options.join(", ") || "",
      "Total Options": spec?.options.length || 0,
      "Issues Found": result.explanation || "None",
      "Problematic Options": result.problematic_options?.join(", ") || "None"
    };
  });

  const sheet = XLSX.utils.json_to_sheet(auditData);
  XLSX.utils.book_append_sheet(workbook, sheet, "Audit Results");

  const fileName = `${mcatName}_Audit_${new Date().toISOString().split("T")[0]}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}

// excel.ts file mein jaao aur yeh function update karo:

export function generateCombinedExcel(
  mcatName: string,
  auditResults: AuditResult[],
  originalSpecs: UploadedSpec[],
  isqs: { config: ISQ; keys: ISQ[]; buyers: ISQ[] },
  commonSpecs: Array<{ spec_name: string; options: string[]; category: string }> // ← YEH ADD KARO
) {
  const workbook = XLSX.utils.book_new();

  // Tab 1: Stage 1 - Audit (EXISTING - NO CHANGE)
  const auditData: unknown[] = auditResults.map((result) => {
    const spec = originalSpecs.find((s) => s.spec_name === result.specification);
    return {
      "Specification Name": result.specification,
      "Status": result.status === "correct" ? "CORRECT" : "INCORRECT",
      "Tier": spec?.tier || "N/A",
      "Input Type": spec?.input_type || "N/A",
      "Options (Comma Separated)": spec?.options.join(", ") || "",
      "Total Options": spec?.options.length || 0,
      "Issues Found": result.explanation || "None",
      "Problematic Options": result.problematic_options?.join(", ") || "None"
    };
  });

  const auditSheet = XLSX.utils.json_to_sheet(auditData);
  XLSX.utils.book_append_sheet(workbook, auditSheet, "Stage 1 - Audit");

  // Tab 2: Stage 2 - ISQs (EXISTING - NO CHANGE)
  const stage2ISQs: unknown[] = [
    {
      "ISQ Type": "Config",
      "ISQ Name": isqs.config.name,
      "Options (Comma Separated)": isqs.config.options.join(", "),
      "Total Options": isqs.config.options.length,
    },
    ...isqs.keys.map((k, i) => ({
      "ISQ Type": "Key",
      "ISQ Name": k.name,
      "Options (Comma Separated)": k.options.join(", "),
      "Total Options": k.options.length,
      "Rank": i + 1,
    })),
  ];

  const stage2Sheet = XLSX.utils.json_to_sheet(stage2ISQs);
  XLSX.utils.book_append_sheet(workbook, stage2Sheet, "Stage 2 - ISQs");

  // Tab 3: NEW - Stage 3 - Common Specifications (YEH ADD KARO)
  if (commonSpecs && commonSpecs.length > 0) {
    const commonSpecsData: unknown[] = commonSpecs.map((spec, idx) => ({
      "Rank": idx + 1,
      "Spec Name": spec.spec_name,
      "Category": spec.category,
      "Common Options": spec.options.join(", "),
      "Total Options": spec.options.length,
      "Status": spec.options.length > 0 ? "✅ Found" : "❌ No common options"
    }));

    const commonSpecsSheet = XLSX.utils.json_to_sheet(commonSpecsData);
    XLSX.utils.book_append_sheet(workbook, commonSpecsSheet, "Stage 3 - Common Specs");
  }

  // Tab 4: Stage 3 - Buyer ISQs (EXISTING - NO CHANGE)
  const buyerISQs: unknown[] = isqs.buyers.map((b, idx) => ({
    "Rank": idx + 1,
    "Buyer ISQ Name": b.name,
    "Options (Comma Separated)": b.options.join(", "),
    "Total Options": b.options.length,
  }));

  if (buyerISQs.length > 0) {
    const buyerISQsSheet = XLSX.utils.json_to_sheet(buyerISQs);
    XLSX.utils.book_append_sheet(workbook, buyerISQsSheet, "Stage 3 - Buyer ISQs");
  }

  const fileName = `${mcatName}_Complete_${new Date().toISOString().split("T")[0]}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
export function generateExcelFile(
  stage1: Stage1Output,
  isqs: { config: ISQ; keys: ISQ[]; buyers: ISQ[] }
) {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Master Spec Extraction
  const masterSpecs: unknown[] = [];
  stage1.seller_specs.forEach((ss) => {
    ss.mcats.forEach((mcat) => {
      const { finalized_primary_specs, finalized_secondary_specs, finalized_tertiary_specs } =
        mcat.finalized_specs;

      finalized_primary_specs.specs.forEach((s) => {
        masterSpecs.push({
          MCAT: mcat.category_name,
          "Spec Name": s.spec_name,
          Tier: "Primary",
          "Input Type": s.input_type,
          "Affix Flag": s.affix_flag,
          "Affix Presence": s.affix_presence_flag,
          "Options (Comma Separated)": s.options.join(", "),
        });
      });

      finalized_secondary_specs.specs.forEach((s) => {
        masterSpecs.push({
          MCAT: mcat.category_name,
          "Spec Name": s.spec_name,
          Tier: "Secondary",
          "Input Type": s.input_type,
          "Affix Flag": s.affix_flag,
          "Affix Presence": s.affix_presence_flag,
          "Options (Comma Separated)": s.options.join(", "),
        });
      });

      finalized_tertiary_specs.specs.forEach((s) => {
        masterSpecs.push({
          MCAT: mcat.category_name,
          "Spec Name": s.spec_name,
          Tier: "Tertiary",
          "Input Type": s.input_type,
          "Affix Flag": s.affix_flag,
          "Affix Presence": s.affix_presence_flag,
          "Options (Comma Separated)": s.options.join(", "),
        });
      });
    });
  });

  const sheet1 = XLSX.utils.json_to_sheet(masterSpecs);
  XLSX.utils.book_append_sheet(workbook, sheet1, "Master Spec Extraction");

  // Sheet 2: Website Evidence
  const websiteEvidence: unknown[] = [
    {
      "ISQ Type": "Config",
      "ISQ Name": isqs.config.name,
      "Options Found": isqs.config.options.join(", "),
    },
    ...isqs.keys.map((k, i) => ({
      "ISQ Type": "Key",
      "ISQ Name": k.name,
      "Options Found": k.options.join(", "),
      "Popularity Rank": i + 1,
    })),
  ];

  const sheet2 = XLSX.utils.json_to_sheet(websiteEvidence);
  XLSX.utils.book_append_sheet(workbook, sheet2, "Website Evidence");

  // Sheet 3: Final ISQs
  const finalISQs: unknown[] = [
    {
      Type: "Config",
      Name: isqs.config.name,
      "Option 1": isqs.config.options[0] || "",
      "Option 2": isqs.config.options[1] || "",
      "Option 3": isqs.config.options[2] || "",
      "Option 4": isqs.config.options[3] || "",
      "Option 5": isqs.config.options[4] || "",
      "Total Options": isqs.config.options.length,
    },
  ];

  isqs.keys.forEach((k) => {
    finalISQs.push({
      Type: "Key ISQ",
      Name: k.name,
      "Option 1": k.options[0] || "",
      "Option 2": k.options[1] || "",
      "Option 3": k.options[2] || "",
      "Option 4": k.options[3] || "",
      "Option 5": k.options[4] || "",
      "Total Options": k.options.length,
    });
  });

  isqs.buyers.forEach((b) => {
    finalISQs.push({
      Type: "Buyer ISQ",
      Name: b.name,
      "Option 1": b.options[0] || "",
      "Option 2": b.options[1] || "",
      "Option 3": b.options[2] || "",
      "Option 4": b.options[3] || "",
      "Option 5": b.options[4] || "",
      "Total Options": b.options.length,
    });
  });

  const sheet3 = XLSX.utils.json_to_sheet(finalISQs);
  XLSX.utils.book_append_sheet(workbook, sheet3, "Stage 2 - Final ISQs");

  // Sheet 4: Stage 3 - Common Specifications
  const stage3Data = extractStage3Data(stage1, isqs);

  const commonSpecsSheet: unknown[] = stage3Data.commonSpecs.map((spec) => ({
    "Spec Name": spec.spec_name,
    Category: spec.category,
    "Input Type": spec.input_type,
    "Options (Comma Separated)": spec.options.join(", "),
    "Total Options": spec.options.length,
  }));

  if (commonSpecsSheet.length > 0) {
    const sheet4 = XLSX.utils.json_to_sheet(commonSpecsSheet);
    XLSX.utils.book_append_sheet(workbook, sheet4, "Stage 3 - Common Specs");
  }

  // Sheet 5: Stage 3 - Buyer ISQs
  const buyerISQsSheet: unknown[] = stage3Data.buyerISQs.map((spec, idx) => ({
    "Rank": idx + 1,
    "Spec Name": spec.spec_name,
    Category: spec.category,
    "Options (Comma Separated)": spec.options.join(", "),
    "Total Options": spec.options.length,
  }));

  if (buyerISQsSheet.length > 0) {
    const sheet5 = XLSX.utils.json_to_sheet(buyerISQsSheet);
    XLSX.utils.book_append_sheet(workbook, sheet5, "Stage 3 - Buyer ISQs");
  }

  // Download
  const fileName = `ISQ_Specifications_${new Date().toISOString().split("T")[0]}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}

function extractStage3Data(
  stage1: Stage1Output,
  isqs: { config: ISQ; keys: ISQ[]; buyers: ISQ[] }
): { commonSpecs: CommonSpecItem[]; buyerISQs: BuyerISQItem[] } {
  const stage2ISQs = [isqs.config, ...isqs.keys, ...isqs.buyers];

  const stage1AllSpecs: Array<{
    spec_name: string;
    options: string[];
    input_type: string;
    tier: 'Primary' | 'Secondary' | 'Tertiary';
  }> = [];

  stage1.seller_specs.forEach((ss) => {
    ss.mcats.forEach((mcat) => {
      const { finalized_primary_specs, finalized_secondary_specs } = mcat.finalized_specs;

      finalized_primary_specs.specs.forEach((spec) => {
        stage1AllSpecs.push({
          spec_name: spec.spec_name,
          options: spec.options,
          input_type: spec.input_type,
          tier: 'Primary'
        });
      });

      finalized_secondary_specs.specs.forEach((spec) => {
        stage1AllSpecs.push({
          spec_name: spec.spec_name,
          options: spec.options,
          input_type: spec.input_type,
          tier: 'Secondary'
        });
      });
    });
  });

  const commonSpecs: CommonSpecItem[] = [];
  const matchedStage2 = new Set<number>();

  stage1AllSpecs.forEach((stage1Spec) => {
    stage2ISQs.forEach((stage2ISQ, j) => {
      if (matchedStage2.has(j)) return;

      if (isSemanticallySimilar(stage1Spec.spec_name, stage2ISQ.name)) {
        matchedStage2.add(j);

        const commonOptions = findCommonOptionsOnly(stage1Spec.options, stage2ISQ.options);

        if (commonOptions.length > 0) {
          commonSpecs.push({
            spec_name: stage1Spec.spec_name,
            options: commonOptions,
            input_type: stage1Spec.input_type,
            category: stage1Spec.tier
          });
        }
      }
    });
  });

  const buyerISQs = selectTopBuyerISQs(commonSpecs, stage2ISQs, stage1AllSpecs);

  return { commonSpecs, buyerISQs };
}

function isSemanticallySimilar(spec1: string, spec2: string): boolean {
  const normalize = (str: string) =>
    str.toLowerCase()
      .replace(/[()\-_,.;]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)
      .join(' ')
      .trim();

  const norm1 = normalize(spec1);
  const norm2 = normalize(spec2);

  if (norm1 === norm2) return true;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  const synonymGroups = [
    ['material', 'composition', 'fabric'],
    ['grade', 'quality', 'class', 'standard'],
    ['thickness', 'thk', 'gauge'],
    ['size', 'dimension', 'measurement'],
    ['diameter', 'dia', 'bore'],
    ['length', 'long', 'lng'],
    ['width', 'breadth', 'wide'],
    ['height', 'high', 'depth'],
    ['color', 'colour', 'shade'],
    ['finish', 'surface', 'coating', 'polish'],
    ['weight', 'wt', 'mass'],
    ['type', 'kind', 'variety', 'style'],
    ['shape', 'form', 'profile'],
  ];

  for (const group of synonymGroups) {
    const hasSpec1 = group.some(word => norm1.includes(word));
    const hasSpec2 = group.some(word => norm2.includes(word));
    if (hasSpec1 && hasSpec2) return true;
  }

  return false;
}

function isSemanticallySimilarOption(opt1: string, opt2: string): boolean {
  const normalize = (str: string) =>
    str.toLowerCase()
      .replace(/^ss\s*/i, '')
      .replace(/^ms\s*/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

  const norm1 = normalize(opt1);
  const norm2 = normalize(opt2);

  return norm1 === norm2;
}

function findCommonOptionsOnly(options1: string[], options2: string[]): string[] {
  const common: string[] = [];
  const usedIndices = new Set<number>();

  options1.forEach((opt1) => {
    options2.forEach((opt2, j) => {
      if (usedIndices.has(j)) return;
      if (isSemanticallySimilarOption(opt1, opt2)) {
        common.push(opt1);
        usedIndices.add(j);
      }
    });
  });

  return common;
}

function selectTopBuyerISQs(
  commonSpecs: CommonSpecItem[],
  stage2ISQs: ISQ[],
  stage1AllSpecs: Array<{
    spec_name: string;
    options: string[];
    input_type: string;
    tier: 'Primary' | 'Secondary' | 'Tertiary';
  }>
): BuyerISQItem[] {
  const scoredSpecs = commonSpecs.map(spec => {
    let score = 0;

    if (spec.category === 'Primary') score += 3;
    if (spec.category === 'Secondary') score += 1;

    score += Math.min(spec.options.length, 5);

    const isInStage2Important = stage2ISQs.some(isq =>
      isSemanticallySimilar(spec.spec_name, isq.name)
    );
    if (isInStage2Important) score += 2;

    return { ...spec, score };
  });

  scoredSpecs.sort((a, b) => b.score - a.score);

  const topSpecs = scoredSpecs.slice(0, 2);

  return topSpecs.map(spec => {
    const correspondingStage2ISQ = stage2ISQs.find(isq =>
      isSemanticallySimilar(spec.spec_name, isq.name)
    );

    const originalStage1Spec = stage1AllSpecs.find(s1 =>
      isSemanticallySimilar(s1.spec_name, spec.spec_name)
    );

    let finalOptions = spec.options;

    if (correspondingStage2ISQ && originalStage1Spec) {
      finalOptions = getBuyerISQOptions(
        originalStage1Spec.options,
        correspondingStage2ISQ.options
      );
    }

    return {
      spec_name: spec.spec_name,
      options: finalOptions,
      category: spec.category
    };
  });
}

function getBuyerISQOptions(stage1Options: string[], stage2Options: string[]): string[] {
  const result: string[] = [];
  const used = new Set<string>();

  const matchedStage2Indices = new Set<number>();

  stage1Options.forEach((opt1) => {
    stage2Options.forEach((opt2, j) => {
      if (result.length >= 8) return;
      if (matchedStage2Indices.has(j)) return;

      if (isSemanticallySimilarOption(opt1, opt2)) {
        result.push(opt1);
        used.add(opt1.toLowerCase());
        matchedStage2Indices.add(j);
      }
    });
  });

  if (result.length < 8) {
    stage1Options.forEach(opt1 => {
      if (result.length >= 8) return;
      const optLower = opt1.toLowerCase();
      if (!used.has(optLower)) {
        result.push(opt1);
        used.add(optLower);
      }
    });
  }

  if (result.length < 8) {
    stage2Options.forEach((opt2, j) => {
      if (result.length >= 8) return;
      if (!matchedStage2Indices.has(j)) {
        const optLower = opt2.toLowerCase();
        if (!used.has(optLower)) {
          result.push(opt2);
          used.add(optLower);
        }
      }
    });
  }

  return result.slice(0, 8);
}
