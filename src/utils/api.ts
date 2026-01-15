import type { InputData, Stage1Output, ISQ, ExcelData, AuditInput, AuditResult } from "../types";


function normalizeSpecName(name: string): string {
  let normalized = name.toLowerCase().trim();
  normalized = normalized.replace(/[()\-_,.;]/g, ' ');
  
  const standardizations: Record<string, string> = {
    'material': 'material',
    'grade': 'grade',
    'thk': 'thickness',
    'thickness': 'thickness',
    'type': 'type',
    'shape': 'shape',
    'size': 'size',
    'dimension': 'size',
    'length': 'length',
    'width': 'width',
    'height': 'height',
    'dia': 'diameter',
    'diameter': 'diameter',
    'color': 'color',
    'colour': 'color',
    'finish': 'finish',
    'surface': 'finish',
    'weight': 'weight',
    'wt': 'weight',
    'capacity': 'capacity',
    'brand': 'brand',
    'model': 'model',
    'quality': 'quality',
    'standard': 'standard',
    'specification': 'spec',
    'perforation': 'hole',
    'hole': 'hole',
    'pattern': 'pattern',
    'design': 'design',
    'application': 'application',
    'usage': 'application'
  };
  
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  const standardizedWords = words.map(word => {
    if (standardizations[word]) {
      return standardizations[word];
    }
    
    for (const [key, value] of Object.entries(standardizations)) {
      if (word.includes(key) || key.includes(word)) {
        return value;
      }
    }
    
    return word;
  });
  
  const uniqueWords = [...new Set(standardizedWords)];
  const fillerWords = ['sheet', 'plate', 'pipe', 'rod', 'bar', 'in', 'for', 'of', 'the'];
  const filteredWords = uniqueWords.filter(word => !fillerWords.includes(word));
  
  return filteredWords.join(' ').trim();
}

function isSemanticallySimilar(spec1: string, spec2: string): boolean {
  const norm1 = normalizeSpecName(spec1);
  const norm2 = normalizeSpecName(spec2);
  
  if (norm1 === norm2) return true;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
  
  const synonymGroups = [
    ['material', 'composition', 'fabric'],
    ['grade', 'quality', 'class'],
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
    ['hole', 'perforation', 'aperture'],
    ['pattern', 'design', 'arrangement'],
    ['application', 'use', 'purpose', 'usage']
  ];
  
  for (const group of synonymGroups) {
    const hasSpec1 = group.some(word => norm1.includes(word));
    const hasSpec2 = group.some(word => norm2.includes(word));
    if (hasSpec1 && hasSpec2) return true;
  }
  
  return false;
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  baseDelay = 10000
): Promise<Response> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (response.ok) return response;

      lastStatus = response.status;

      if (response.status === 429 || response.status === 503 || response.status === 502) {
        if (attempt === retries) {
          throw new Error(`Gemini overloaded after ${retries + 1} attempts. Last status code: ${lastStatus}`);
        }
        const waitTime = baseDelay * Math.pow(2, attempt);
        console.warn(`Gemini overloaded (${response.status}). Retrying in ${waitTime}ms`);
        await sleep(waitTime);
        continue;
      }

      const err = await response.text();
      throw new Error(`Gemini API error ${lastStatus}: ${err}`);
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn(`⏱️ Request timeout on attempt ${attempt + 1}`);
        if (attempt === retries) {
          throw new Error(`Request timed out after ${retries + 1} attempts`);
        }
        const waitTime = baseDelay * Math.pow(2, attempt);
        console.warn(`Waiting ${waitTime}ms before retry...`);
        await sleep(waitTime);
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unreachable");
}

function extractJSONFromGemini(response): any {
  try {
    console.log("🛠️ SUPER LENIENT JSON Extraction: Starting...");
    
    if (!response?.candidates?.length) {
      console.warn("❌ No candidates");
      return null;
    }

    const parts = response.candidates[0]?.content?.parts || [];
    let rawText = "";

    // Collect ALL text
    for (const part of parts) {
      if (typeof part.text === "string") {
        rawText += part.text + "\n";
      }
      if (part.json) {
        console.log("✅ Direct JSON found");
        return part.json;
      }
    }

    if (!rawText.trim()) {
      console.warn("⚠️ No text");
      return null;
    }

    console.log(`📊 Gemini raw response length: ${rawText.length} chars`);
    console.log("🔍 First 600 chars:");
    console.log(rawText.substring(0, 600));
    
    // CRITICAL: Super aggressive extraction
    const extracted = extractAnyJSONPossible(rawText);
    
    if (extracted) {
      console.log("🎉 Extracted SOMETHING from Gemini!");
      console.log("📦 Extracted data:", extracted);
      return extracted;
    }
    
    console.warn("⚠️ Could not extract anything");
    return null;

  } catch (error) {
    console.error("💥 JSON extraction error:", error);
    return null;
  }
}

// UPDATED: extractAnyJSONPossible function with better incomplete JSON handling
function extractAnyJSONPossible(text: string): any {
  console.log("🔥 SUPER AGGRESSIVE: Extracting ANY JSON-like structure...");
  
  // Clean the text first
  let cleaned = text.trim();
  
  // Remove any trailing text after last valid JSON character
  const lastValidChar = Math.max(
    cleaned.lastIndexOf('}'),
    cleaned.lastIndexOf(']')
  );
  
  if (lastValidChar > 0 && lastValidChar < cleaned.length - 1) {
    cleaned = cleaned.substring(0, lastValidChar + 1);
  }
  
  // FIX: Remove spec name from options arrays
  cleaned = removeSpecNameFromOptions(cleaned);
  
  // TRY 1: Direct parse
  try {
    const parsed = JSON.parse(cleaned);
    console.log("✅ Direct JSON parse worked!");
    return validateAndCleanParsedJSON(parsed);
  } catch (e) {
    console.log("🔄 Direct parse failed, trying to fix incomplete JSON...");
  }
  
  // TRY 2: Fix incomplete JSON
  const fixedJSON = fixIncompleteJSON(cleaned);
  if (fixedJSON) {
    try {
      const parsed = JSON.parse(fixedJSON);
      console.log("✅ Successfully parsed fixed JSON!");
      return validateAndCleanParsedJSON(parsed);
    } catch (e) {
      console.log("❌ Fixed parse failed:", e.message);
    }
  }
  
  // TRY 3: Manual extraction
  console.log("🔄 Trying manual extraction from text...");
  return extractFromTextManually(cleaned);
}

// NEW FUNCTION: Remove spec name from options arrays
function removeSpecNameFromOptions(text: string): string {
  // Find config name
  const configNameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
  if (!configNameMatch) return text;
  
  const configName = configNameMatch[1];
  console.log(`🔍 Found config name: "${configName}"`);
  
  // Find options array and remove config name from it
  const optionsRegex = /"options"\s*:\s*\[([\s\S]*?)\]/g;
  let result = text;
  let match;
  
  while ((match = optionsRegex.exec(text)) !== null) {
    const optionsText = match[1];
    const optionsArray = optionsText.split(',');
    
    // Filter out the config name
    const filteredOptions = optionsArray.filter(opt => {
      const cleanOpt = opt.trim().replace(/["']/g, '');
      return cleanOpt.toLowerCase() !== configName.toLowerCase();
    });
    
    // Replace if we filtered something out
    if (filteredOptions.length < optionsArray.length) {
      const newOptionsText = filteredOptions.join(',');
      result = result.replace(optionsText, newOptionsText);
      console.log(`🔧 Removed "${configName}" from options array`);
    }
  }
  
  return result;
}

// NEW FUNCTION: Fix incomplete JSON
function fixIncompleteJSON(jsonStr: string): string | null {
  console.log("🔧 Attempting to fix incomplete JSON...");
  
  let fixed = jsonStr;
  
  // 1. Fix unclosed strings
  fixed = fixed.replace(/"([^"\n\r]*?)(?=\s*[,}\]])/g, '"$1"');
  
  // 2. Fix arrays that end abruptly
  fixed = fixed.replace(/(\[[^\]]*?)(\s*$)/g, '$1]');
  
  // 3. Fix objects that end abruptly
  fixed = fixed.replace(/(\{[^}]*?)(\s*$)/g, '$1}');
  
  // 4. Balance braces and brackets
  const openBraces = (fixed.match(/\{/g) || []).length;
  const closeBraces = (fixed.match(/\}/g) || []).length;
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;
  
  // Add missing closing brackets
  if (openBrackets > closeBrackets) {
    fixed += ']'.repeat(openBrackets - closeBrackets);
  }
  
  // Add missing closing braces
  if (openBraces > closeBraces) {
    fixed += '}'.repeat(openBraces - closeBraces);
  }
  
  // 5. Fix trailing commas
  fixed = fixed.replace(/,\s*([\]}])/g, '$1');
  
  // Check if it's parseable now
  try {
    JSON.parse(fixed);
    console.log("✅ JSON fixing successful");
    return fixed;
  } catch (e) {
    console.log("❌ Still not valid JSON");
    return null;
  }
}

// NEW FUNCTION: Validate and clean parsed JSON
function validateAndCleanParsedJSON(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  
  const result: any = {
    config: { name: "", options: [] },
    keys: [],
    buyers: []
  };
  
  // Validate config
  if (parsed.config && parsed.config.name) {
    result.config.name = parsed.config.name;
    
    // Clean config options
    if (Array.isArray(parsed.config.options)) {
      result.config.options = parsed.config.options
        .filter((opt: any) => {
          if (typeof opt !== 'string') return false;
          const cleanOpt = opt.trim();
          return cleanOpt.length > 0 && 
                 cleanOpt.length < 50 &&
                 cleanOpt.toLowerCase() !== result.config.name.toLowerCase();
        })
        .slice(0, 8);
    }
  }
  
  // Validate keys
  if (Array.isArray(parsed.keys)) {
    result.keys = parsed.keys
      .filter((key: any) => 
        key && 
        key.name && 
        typeof key.name === 'string' &&
        key.name !== result.config.name
      )
      .map((key: any) => ({
        name: key.name,
        options: Array.isArray(key.options) 
          ? key.options
              .filter((opt: any) => typeof opt === 'string' && opt.trim().length > 0)
              .slice(0, 6)
          : []
      }))
      .filter((key: any) => key.options.length > 0)
      .slice(0, 3);
  }
  
  // Validate buyers
  if (Array.isArray(parsed.buyers)) {
    result.buyers = parsed.buyers.slice(0, 2);
  }
  
  return result;
}

// NEW FUNCTION: Extract from text manually
function extractFromTextManually(text: string): any {
  console.log("🔨 Manual extraction from text...");
  
  const result: any = {
    config: { name: "", options: [] },
    keys: [],
    buyers: []
  };
  
  // Extract config name
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
  if (nameMatch) {
    result.config.name = nameMatch[1];
  } else {
    // Try to guess from text
    if (text.includes('Grade')) result.config.name = 'Grade';
    else if (text.includes('Material')) result.config.name = 'Material';
    else if (text.includes('Size')) result.config.name = 'Size';
    else result.config.name = 'Specification';
  }
  
  // Extract all possible options
  const allOptions = new Set<string>();
  
  // Look for options arrays
  const optionsMatches = text.matchAll(/"options"\s*:\s*\[([^\]]+)\]/g);
  for (const match of optionsMatches) {
    const optionsText = match[1];
    const quotedOptions = optionsText.match(/"([^"]+)"/g) || [];
    quotedOptions.forEach(opt => {
      const cleanOpt = opt.replace(/"/g, '').trim();
      if (cleanOpt && cleanOpt.toLowerCase() !== result.config.name.toLowerCase()) {
        allOptions.add(cleanOpt);
      }
    });
  }
  
  // Also look for any quoted strings that could be options
  const allQuoted = text.match(/"([^"\n\r,;\[\]{}]+)"/g) || [];
  allQuoted.forEach(opt => {
    const cleanOpt = opt.replace(/"/g, '').trim();
    if (cleanOpt && 
        cleanOpt.length > 1 && 
        cleanOpt.length < 30 &&
        !cleanOpt.toLowerCase().includes('name') &&
        !cleanOpt.toLowerCase().includes('options') &&
        !cleanOpt.toLowerCase().includes('config') &&
        !cleanOpt.toLowerCase().includes('keys') &&
        cleanOpt.toLowerCase() !== result.config.name.toLowerCase()) {
      allOptions.add(cleanOpt);
    }
  });
  
  result.config.options = Array.from(allOptions).slice(0, 8);
  
  // Try to extract keys from the text
  extractKeysFromTextContent(text, result);
  
  return result;
}

// NEW FUNCTION: Extract keys from text content
function extractKeysFromTextContent(text: string, result: any): void {
  const keyPatterns = [
    { name: "Finish", regex: /finish[\s\S]*?"options"[\s\S]*?\[([^\]]+)\]/i },
    { name: "Standard", regex: /standard[\s\S]*?"options"[\s\S]*?\[([^\]]+)\]/i },
    { name: "Type", regex: /type[\s\S]*?"options"[\s\S]*?\[([^\]]+)\]/i },
    { name: "Size", regex: /size[\s\S]*?"options"[\s\S]*?\[([^\]]+)\]/i },
    { name: "Thickness", regex: /thickness[\s\S]*?"options"[\s\S]*?\[([^\]]+)\]/i }
  ];
  
  keyPatterns.forEach(pattern => {
    if (result.keys.length >= 3) return;
    
    const match = text.match(pattern.regex);
    if (match) {
      const optionsText = match[1];
      const options = extractOptionsFromString(optionsText);
      if (options.length > 0 && pattern.name !== result.config.name) {
        result.keys.push({
          name: pattern.name,
          options: options.slice(0, 6)
        });
      }
    }
  });
}

// NEW FUNCTION: Extract options from string
function extractOptionsFromString(str: string): string[] {
  const options: string[] = [];
  const quotedMatches = str.match(/"([^"]+)"/g) || [];
  quotedMatches.forEach(match => {
    const opt = match.replace(/"/g, '').trim();
    if (opt) options.push(opt);
  });
  return options;
}

const STAGE1_API_KEY = (import.meta.env.VITE_STAGE1_API_KEY || "").trim();
const STAGE2_API_KEY = (import.meta.env.VITE_STAGE2_API_KEY || "").trim();
const STAGE3_API_KEY = (import.meta.env.VITE_STAGE3_API_KEY || "").trim();

export async function auditSpecificationsWithGemini(
  input: AuditInput
): Promise<AuditResult[]> {
  if (!STAGE1_API_KEY) {
    throw new Error("Stage 1 API key is not configured. Please add VITE_STAGE1_API_KEY to your .env file.");
  }

  const prompt = buildAuditPrompt(input);
  console.log("🔍 Audit: Sending request to Gemini...");

  try {
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${STAGE1_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();
    console.log("📥 Audit: Received response from Gemini");

    let result = extractJSONFromGemini(data);

    if (!result || !Array.isArray(result)) {
      console.warn("⚠️ Audit: JSON extraction failed, trying text extraction...");
      const rawText = extractRawText(data);
      console.log("Raw response text:", rawText.substring(0, 500));

      result = parseAuditFromText(rawText, input);
    }

    if (result && Array.isArray(result)) {
      console.log(`✅ Audit: Successfully parsed ${result.length} results`);
      console.log("Audit results:", result);
      return result;
    }

    console.error("❌ Audit: Failed to parse any results, returning empty array");
    return [];
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes("429") || errorMsg.includes("quota")) {
      console.error("Stage 1 API Key quota exhausted or rate limited");
      throw new Error("Stage 1 API key quota exhausted. Please check your API limits.");
    }

    console.error("❌ Audit API error:", error);
    throw error;
  }
}

function parseAuditFromText(text: string, input: AuditInput): AuditResult[] {
  console.log("📝 Parsing audit from text...");

  const results: AuditResult[] = [];

  // Try to find JSON array in text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0].replace(/,(\s*[\]}])/g, "$1"));
      if (Array.isArray(parsed)) {
        console.log("✅ Successfully parsed JSON array from text");
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to parse JSON array from text:", e);
    }
  }

  // Fallback: Create results for all specs marking them as "correct" if no issues found
  input.specifications.forEach(spec => {
    results.push({
      specification: spec.spec_name,
      status: "correct",
      explanation: undefined,
      problematic_options: []
    });
  });

  console.log(`⚠️ Fallback: Marking all ${results.length} specs as correct`);
  return results;
}

function buildAuditPrompt(input: AuditInput): string {
  const specsText = input.specifications
    .map((spec, idx) => {
      return `${idx + 1}. Specification: "${spec.spec_name}"
   Options: ${spec.options.map(opt => `"${opt}"`).join(", ")}
   Input Type: ${spec.input_type || "N/A"}
   Tier: ${spec.tier || "N/A"}`;
    })
    .join("\n\n");

  return `You are a STRICT industrial specification auditor. Your task is to find REAL problems.

MCAT Name: ${input.mcat_name}
Think about what specifications make sense for this type of product.

Specifications to Audit:
${specsText}

Task:
- For each specification, check if it is relevant to the MCAT "${input.mcat_name}"
- For each option, check for:
  • Irrelevance to the specification or MCAT
  • Duplicates (exact duplicates or same value listed multiple times)
   Example: "SS304", "ss304" → INCORRECT (duplicate, just different case)
   Example: "2mm", "2 mm", "2.0mm" → INCORRECT (same value, different formatting)
  • Overlapping values (e.g., same measurement in multiple separate options like "1219 mm" AND "4 ft" as separate entries)

ADDITIONAL CRITICAL RULE (MCAT NAME CONFLICT CHECK):

If the MCAT name itself already explicitly defines a specification, and the same specification is again created with:
• the same value, OR
• multiple alternative values, OR
• contradictory values
→ then the entire specification must be marked INCORRECT.

Example:
MCAT Name: "304 Stainless Steel Sheet"
Specification: Grade
Options: "304", "316", "202"
→ INCORRECT because the grade is already fixed by the MCAT name

Rules:
- DO NOT generate new specifications or options
- DO NOT suggest random corrections
- BE STRICT and find REAL issues
- Only return "correct" or "incorrect" and explanation if incorrect
- If an option lists different units in the SAME entry (e.g., "1219 mm (4 ft)") → this is CORRECT
- If multiple SEPARATE options represent the same value in different units → this is INCORRECT (overlapping)
- If an option appears multiple times with exactly the same value → this is INCORRECT (duplicate)
- If a specification is completely irrelevant to "${input.mcat_name}" → mark as INCORRECT with explanation
- If an option is irrelevant to the specification → mark as INCORRECT and list it in problematic_options

Output Format (JSON Array):
[
  {
    "specification": "Grade",
    "status": "correct"
  },
  {
    "specification": "Width",
    "status": "incorrect",
    "explanation": "1219 mm and 4 ft listed separately → overlapping units. 1500 mm appears twice → duplicate.",
    "problematic_options": ["1219 mm", "4 ft", "1500 mm"]
  },
  {
    "specification": "Application",
    "status": "incorrect",
    "explanation": "Specification not relevant for ${input.mcat_name}. Option 'Capacity' is irrelevant.",
    "problematic_options": ["Capacity"]
  }
]

CRITICAL:
- Return ONLY valid JSON array
- NO text before or after the JSON
- NO markdown code blocks
- Output must start with [ and end with ]`;
}

export async function generateStage1WithGemini(
  input: InputData
): Promise<Stage1Output> {
  if (!STAGE1_API_KEY) {
    throw new Error("Stage 1 API key is not configured. Please add VITE_STAGE1_API_KEY to your .env file.");
  }

  const prompt = buildStage1Prompt(input);

  try {
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${STAGE1_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 4096,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();
    return extractJSONFromGemini(data) || generateFallbackStage1();

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes("429") || errorMsg.includes("quota")) {
      console.error("Stage 1 API Key quota exhausted or rate limited");
      throw new Error("Stage 1 API key quota exhausted. Please check your API limits.");
    }

    console.warn("Stage 1 API error:", error);
    return generateFallbackStage1();
  }
}

function generateFallbackStage1(): Stage1Output {
  return {
    seller_specs: []
  };
}

// ==================== CORS FIXED VERSION ====================

async function fetchURL(url: string): Promise<string> {
  console.log(`🔗 Enhanced scraping for: ${url}`);
  
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&callback=?`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://proxy.cors.sh/${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url
  ];

  for (let i = 0; i < proxies.length; i++) {
    const proxyUrl = proxies[i];
    const isDirect = proxyUrl === url;
    
    console.log(`🔄 Attempt ${i + 1}/${proxies.length}: ${isDirect ? 'Direct' : 'Proxy'}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(proxyUrl, {
        signal: controller.signal,
        headers: !isDirect ? {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,/;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache'
        } : {}
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.warn(`⚠️ Attempt ${i + 1} failed with status: ${response.status}`);
        continue;
      }
      
      let html = '';
      
      if (proxyUrl.includes('allorigins.win')) {
        const data = await response.json();
        html = data.contents || '';
      } else {
        html = await response.text();
      }
      
      if (!html || html.trim().length === 0) {
        console.warn(`⚠️ Attempt ${i + 1} returned empty content`);
        continue;
      }
      
      // ========== ENHANCED SCRAPING LOGIC ==========
      const doc = new DOMParser().parseFromString(html, "text/html");
      
      // 1. पहले specification tables ढूंढें
      let allSpecText = '';
      
      // Tables with specifications
      const tables = doc.querySelectorAll('table');
      console.log(`📊 Found ${tables.length} tables`);
      
      tables.forEach((table, index) => {
        const tableText = table.textContent?.trim() || '';
        if (tableText.length > 20 && tableText.length < 5000) {
          const lowerText = tableText.toLowerCase();
          
          // Check if table contains specification keywords
          const specKeywords = [
            'material', 'grade', 'thickness', 'size', 'diameter',
            'width', 'length', 'standard', 'finish', 'coating',
            'type', 'form', 'tolerance', 'hardness', 'strength',
            'mm', 'cm', 'inch', 'astm', 'is ', 'din', 'jis',
            '304', '316', '430', 'ms', 'ss', 'steel', 'aluminum'
          ];
          
          const hasSpecs = specKeywords.some(keyword => lowerText.includes(keyword));
          
          if (hasSpecs || lowerText.match(/\d+\s*(mm|cm|in)/i)) {
            allSpecText += `\n\n[TABLE ${index + 1}]\n${tableText}`;
          }
        }
      });
      
      // 2. Specification lists ढूंढें
      const lists = doc.querySelectorAll('ul, ol, dl');
      console.log(`📋 Found ${lists.length} lists`);
      
      lists.forEach((list, index) => {
        const items = Array.from(list.querySelectorAll('li, dt, dd'));
        const specItems = items.filter(item => {
          const text = item.textContent?.toLowerCase() || '';
          return text.match(/\d+\s*(mm|cm|in|grade|astm|is)/i) ||
                 text.includes('material') ||
                 text.includes('thickness') ||
                 text.includes('standard') ||
                 text.includes('finish');
        });
        
        if (specItems.length > 0) {
          const listText = specItems.map(item => item.textContent?.trim()).filter(Boolean).join('\n');
          allSpecText += `\n\n[LIST ${index + 1}]\n${listText}`;
        }
      });
      
      // 3. Specification divs ढूंढें
      const specDivs = doc.querySelectorAll([
        '[class*="spec"]',
        '[class*="feature"]',
        '[class*="detail"]',
        '[class*="attribute"]',
        '[class*="property"]',
        '[class*="technical"]',
        '[id*="spec"]',
        '[id*="feature"]'
      ].join(', '));
      
      specDivs.forEach((div, index) => {
        const text = div.textContent?.trim() || '';
        if (text.length > 20 && text.length < 1000) {
          allSpecText += `\n\n[DIV ${index + 1}]\n${text}`;
        }
      });
      
      let finalText = '';
      if (allSpecText.trim()) {
        finalText = allSpecText.trim();
        console.log(`✅ Found structured specifications`);
      } else {
        console.log(`ℹ️ No structured specs found, extracting all text`);
        
        // Remove unwanted elements
        const unwantedSelectors = 'script, style, noscript, iframe, nav, header, footer, aside, form, button, input, select, textarea, svg, img, video, audio, canvas';
        doc.querySelectorAll(unwantedSelectors).forEach(el => el.remove());
        
        finalText = doc.body?.textContent?.trim() || '';
      }
      
      // Clean और limit करें
      finalText = finalText
        .replace(/\s+/g, ' ')
        .trim();
      
      // Irrelevant content filter करें
      const irrelevantPatterns = [
        /copyright\s*©/gi,
        /all\srights\sreserved/gi,
        /privacy\s*policy/gi,
        /terms\sof\suse/gi,
        /contact\s*us/gi,
        /follow\s*us/gi,
        /subscribe/gi,
        /newsletter/gi,
        /cookie\s*policy/gi,
        /shipping/gi,
        /delivery/gi,
        /payment/gi,
        /warranty/gi,
        /return\s*policy/gi
      ];
      
      irrelevantPatterns.forEach(pattern => {
        finalText = finalText.replace(pattern, '');
      });
      
      // Limit to 4000 characters
      if (finalText.length > 4000) {
        finalText = finalText.substring(0, 4000);
      }
      
      console.log(`✅ Success! Got ${finalText.length} characters (${tables.length} tables, ${lists.length} lists)`);
      return finalText;
      
    } catch (error: any) {
      console.warn(`⚠️ Attempt ${i + 1} error: ${error.message}`);
      continue;
    }
  }
  
  console.error(`❌ All attempts failed for URL: ${url}`);
  return "";
}

function parseISQFromText(text: string): { config: ISQ; keys: ISQ[] } | null {
  console.log("🔍 Parsing ISQ from text...");

  try {
    const result: { config: ISQ; keys: ISQ[] } = {
      config: { name: "", options: [] },
      keys: []
    };

    const configMatch = text.match(/===\s*CONFIG SPECIFICATION\s*===\s*\n\s*Name:\s*(.+?)\s*\n\s*Options:\s*(.+?)(?=\n===|\n\n|$)/is);

    if (configMatch) {
      const configName = configMatch[1].trim();
      const configOptionsStr = configMatch[2].trim();

      if (isRelevantSpec(configName)) {
        const configOptions = configOptionsStr
          .split(/\s*\|\s*/)
          .map(opt => opt.trim())
          .filter(opt => opt.length > 0 && isRelevantOption(opt))
          .slice(0, 8);

        if (configOptions.length > 0) {
          result.config = {
            name: configName,
            options: configOptions
          };
          console.log(`✅ Config parsed: ${configName} with ${configOptions.length} options`);
        }
      } else {
        console.warn(`⚠️ Config spec "${configName}" is not relevant, skipping`);
      }
    }

    for (let i = 1; i <= 3; i++) {
      const keyPattern = new RegExp(`===\\s*KEY SPECIFICATION ${i}\\s*===\\s*\\n\\s*Name:\\s*(.+?)\\s*\\n\\s*Options:\\s*(.+?)(?=\\n===|\\n\\n|$)`, 'is');
      const keyMatch = text.match(keyPattern);

      if (keyMatch) {
        const keyName = keyMatch[1].trim();
        const keyOptionsStr = keyMatch[2].trim();

        if (isRelevantSpec(keyName)) {
          const keyOptions = keyOptionsStr
            .split(/\s*\|\s*/)
            .map(opt => opt.trim())
            .filter(opt => opt.length > 0 && isRelevantOption(opt))
            .slice(0, 6);

          if (keyName && keyOptions.length > 0) {
            result.keys.push({
              name: keyName,
              options: keyOptions
            });
            console.log(`✅ Key ${i} parsed: ${keyName} with ${keyOptions.length} options`);
          }
        } else {
          console.warn(`⚠️ Key spec "${keyName}" is not relevant, skipping`);
        }
      }
    }

    if (result.keys.length < 3) {
      console.log(`ℹ️ Found ${result.keys.length} key specifications (expected up to 3)`);
    }

    if (result.config.name && result.config.options.length > 0) {
      console.log(`✅ Parsed: 1 config + ${result.keys.length} keys`);
      return result;
    } else if (result.keys.length > 0) {
      console.log(`✅ Parsed: 0 config + ${result.keys.length} keys`);
      return result;
    } else {
      console.warn(`⚠️ No valid specs found`);
      return null;
    }

  } catch (error) {
    console.error("❌ Error parsing ISQ text:", error);
    return null;
  }
}


function isRelevantSpec(specName: string): boolean {
  const irrelevantSpecs = [
    'measurement system',
    'no data',
    'n/a',
    'not applicable',
    'availability',
    'price',
    'delivery',
    'shipping',
    'payment',
    'warranty',
    'guarantee',
    'location',
    'seller',
    'vendor',
    'supplier'
  ];

  const lowerSpec = specName.toLowerCase().trim();
  return !irrelevantSpecs.some(irr => lowerSpec.includes(irr));
}

function isRelevantOption(option: string): boolean {
  const irrelevantOptions = [
    'other',
    'etc',
    'n/a',
    'not applicable',
    'no data',
    'none',
    'select',
    'choose'
  ];

  const lowerOpt = option.toLowerCase().trim();
  return !irrelevantOptions.some(irr => lowerOpt === irr || lowerOpt.includes(irr));
}

export async function extractISQWithGemini(
  input: InputData,
  urls: string[]
): Promise<{ config: ISQ; keys: ISQ[]; buyers: ISQ[] }> {
  if (!STAGE2_API_KEY) {
    throw new Error("Stage 2 API key is not configured. Please add VITE_STAGE2_API_KEY to your .env file.");
  }

  console.log("🚀 Stage 2: Starting ISQ extraction");
  console.log(`📋 Product: ${input.mcats.map(m => m.mcat_name).join(', ')}`);
  console.log(`🔗 URLs to process: ${urls.length}`);

  await sleep(2000);

  try {
    console.log("🌐 Enhanced scraping with data logging...");
    
    // Load any previously saved data
    const savedData = ScrapedDataLogger.loadFromLocalStorage();
    if (savedData.length > 0) {
      console.log(`📁 Found ${savedData.length} previously scraped entries`);
    }
    
    const urlContentsPromises = urls.map(async (url, index) => {
      console.log(`  📡 [${index + 1}/${urls.length}] Enhanced scraping: ${url}`);
      const content = await fetchURL(url); // This now uses enhanced scraping
      return { url, content, index };
    });

    const results = await Promise.all(urlContentsPromises);

    const urlContents: string[] = [];
    const successfulFetches: number[] = [];

    results.forEach(result => {
      urlContents.push(result.content);
      if (result.content && result.content.length > 0) {
        successfulFetches.push(result.index + 1);
      }
    });

    console.log(`📊 Fetch results: ${successfulFetches.length}/${urls.length} successful`);
    
    // Show detailed stats
    const allScrapedData = ScrapedDataLogger.getAllScrapedData();
    console.group('📈 Scraping Statistics:');
    allScrapedData.forEach((data, idx) => {
      console.log(`${idx + 1}. ${data.url}`);
      console.log(`   Content: ${data.content.length} chars`);
      console.log(`   Tables: ${data.stats.tablesFound}, Lists: ${data.stats.listsFound}`);
      console.log(`   Has tech data: ${data.stats.hasTechnicalData ? '✅' : '❌'}`);
      console.log(`   Keywords: ${data.stats.specKeywords.slice(0, 5).join(', ')}`);
    });
    console.groupEnd();

    if (successfulFetches.length === 0) {
      console.warn("⚠️ No content fetched from any URL");
      alert("❌ No content could be scraped from the URLs. Check console for details.");
      return {
        config: { name: "", options: [] },
        keys: [],
        buyers: []
      };
    }

    const prompt = buildISQExtractionPrompt(input, urls, urlContents);

    console.log("🤖 Calling Gemini API...");

    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${STAGE2_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4000,
            responseMimeType: "text/plain"
          },
        }),
      },
      2,
      10000
    );

    const data = await response.json();
    console.log("✅ Gemini API response received");

    const textResponse = extractRawText(data);
    console.log("📝 Raw text response (first 800 chars):");
    console.log(textResponse.substring(0, 800));

    const parsed = parseISQFromText(textResponse);

    if (!parsed || !parsed.config || !parsed.config.name || parsed.config.options.length === 0) {
      console.warn("⚠️ No valid data extracted from Gemini");
      alert("⚠️ Could not extract specifications from the scraped data. Check the downloaded scraped data to see what was collected.");
      return {
        config: { name: "", options: [] },
        keys: [],
        buyers: []
      };
    }

    console.log(`🎉 Success! Config: ${parsed.config.name} with ${parsed.config.options.length} options`);
    console.log(`🔑 Keys: ${parsed.keys?.length || 0}`);

    // Final notification
    alert(`✅ Stage 2 complete!\n\nScraped data from ${successfulFetches.length} URLs.\nDownload button available at bottom-right.`);

    return {
      config: parsed.config,
      keys: parsed.keys || [],
      buyers: parsed.buyers || []
    };

  } catch (error) {
    console.error("❌ Stage 2 API error:", error);
    alert("❌ Error during Stage 2. Check console for details.");
    return {
      config: { name: "", options: [] },
      keys: [],
      buyers: []
    };
  }
}

function buildISQExtractionPrompt(
  input: InputData,
  urls: string[],
  contents: string[]
): string {
  const urlsText = urls
    .map((url, i) => `URL ${i + 1}: ${url}\nContent: ${contents[i].substring(0, 1000)}...`)
    .join("\n\n");

  const mcatName = input.mcats.map((m) => m.mcat_name).join(", ");

  return `You are an AI that extracts ONLY RELEVANT product specifications from multiple URLs.

Extract specifications from these URLs for: ${mcatName}

IMPORTANT: You have been provided with ${urls.length} URLs. You MUST analyze ALL ${urls.length} URLs and extract specifications that appear across them.

URLs:
${urlsText}

CRITICAL RELEVANCE RULES:
1. ONLY extract specifications that are DIRECTLY RELEVANT to "${mcatName}"
2. DO NOT extract meta-specifications like:
   - "Measurement system" (this is not a product specification)
   - "NO data" (this is not a specification)
   - "Availability" (not a product spec)
   - "Price" (not a product specification)
   - "Delivery" (not a product specification)
   - Generic system settings or UI options
3. DO NOT include specifications already in the MCAT name
4. DO NOT include "Other" or "etc." or "N/A" options
5. ONLY include specs that appear multiple times across URLs
6. You MUST extract at least 2 relevant specifications if they exist across the URLs
7. If URLs contain multiple variants (e.g., 304, 304L, 304H), include ALL of them as separate options

REPEAT VS NON-REPEAT SELECTION LOGIC (VERY IMPORTANT):

1. Prefer specifications that appear in multiple URLs.
2. If enough relevant specs are not found (1 CONFIG + up to 3 KEY),
   include highly relevant specs even if they appear in only one URL.
3. Allow non-repeated specs ONLY when they are clearly relevant.
4. Combine options of the same specification from different URLs,
   even if exact options do not repeat.
5. Do not copy all options from a single URL blindly.

IMPORTANT RANGE HANDLING RULES:
1. If you find overlapping ranges (e.g., "0.14-2.00 mm" and "0.25-2.00 mm"), 
   keep only the WIDER range ("0.14-2.00 mm")
2. If a smaller range is COMPLETELY within a larger range, use ONLY the larger range
3. For thickness/ranges, merge overlapping ranges
4. Example: "0.14-2.00 mm" and "0.25-2.00 mm" → keep "0.14-2.00 mm"
5. Remove redundant ranges that are subsets of other ranges
6. DO NOT use "Range" as a specification name. Use the actual specification name like "Thickness", "Diameter", etc.

INSTRUCTIONS:
1. Extract all RELEVANT specifications from ALL ${urls.length} URLs provided
2. Combine equivalent specifications and options
3. Select 1 CONFIG specification IF FOUND (highest frequency, most price-affecting)
4. Select AT LEAST 2 KEY specifications if they exist across URLs (up to 3 maximum)
5. Options must be the ones most repeated across URLs
6. Maximum 8 options per CONFIG specification, 8 options per KEY specification
7. If you cannot find enough relevant specs, output what you find (don't make up specs)
8. CRITICAL: You MUST try to extract at least 2 relevant specifications total (1 config + at least 1 key, OR 2+ keys if no config found)
9. Analyze ALL URLs - do not stop after finding specs in just 1 or 2 URLs

OUTPUT FORMAT:

=== CONFIG SPECIFICATION ===
Name: [specification name]
Options: [option 1] | [option 2] | [option 3]

=== KEY SPECIFICATION 1 ===
Name: [specification name]
Options: [option 1] | [option 2]

=== KEY SPECIFICATION 2 ===
Name: [specification name]
Options: [option 1] | [option 2]

=== KEY SPECIFICATION 3 ===
Name: [specification name]
Options: [option 1] | [option 2]

NOTE: If you cannot find 3 keys, output only what you find. Quality over quantity.
If a specification is not relevant to "${mcatName}", DO NOT include it.

CRITICAL: Output ONLY the formatted specifications. No explanations, no apologies, no extra text.
`;
}

function areOptionsStronglySimilar(opt1: string, opt2: string): boolean {
  if (!opt1 || !opt2) return false;
  
  const clean1 = opt1.toLowerCase().trim();
  const clean2 = opt2.toLowerCase().trim();
  
  // Direct match
  if (clean1 === clean2) return true;
  
  // Remove spaces and compare
  const noSpace1 = clean1.replace(/\s+/g, '');
  const noSpace2 = clean2.replace(/\s+/g, '');
  if (noSpace1 === noSpace2) return true;
  
  // Material and grade equivalences - MUST MATCH EXACT GRADE
  const materialGroups = [
    ['304', 'ss304', 'ss 304', 'stainless steel 304'],
    ['304l', 'ss304l', 'ss 304l', 'stainless steel 304l'],
    ['316', 'ss316', 'ss 316', 'stainless steel 316'],
    ['316l', 'ss316l', 'ss 316l', 'stainless steel 316l'],
    ['430', 'ss430', 'ss 430'],
    ['201', 'ss201', 'ss 201'],
    ['202', 'ss202', 'ss 202'],
    ['ms', 'mild steel', 'carbon steel'],
    ['gi', 'galvanized iron'],
    ['aluminium', 'aluminum'],
  ];

  for (const group of materialGroups) {
    const inGroup1 = group.some(term => clean1.includes(term));
    const inGroup2 = group.some(term => clean2.includes(term));
    if (inGroup1 && inGroup2) {
      // CRITICAL: Check for exact grade match including suffixes like 'L'
      const extractGrade = (str: string) => {
        // Extract grade like "304", "304L", "316", "316L"
        const match = str.match(/\b(\d+[a-z]*)\b/i);
        return match ? match[1].toLowerCase() : null;
      };

      const grade1 = extractGrade(clean1);
      const grade2 = extractGrade(clean2);

      // If both have grades, they must match exactly (304 ≠ 304L)
      if (grade1 && grade2 && grade1 !== grade2) return false;

      return true;
    }
  }
  
  // Measurement matching
  const getMeasurement = (str: string) => {
    const match = str.match(/(\d+(\.\d+)?)\s*(mm|cm|m|inch|in|ft|"|')?/i);
    if (!match) return null;
    
    const value = parseFloat(match[1]);
    const unit = match[3]?.toLowerCase() || '';
    
    // Convert to mm for comparison
    if (unit === 'cm' || unit === 'centimeter') return value * 10;
    if (unit === 'm' || unit === 'meter') return value * 1000;
    if (unit === 'inch' || unit === 'in' || unit === '"') return value * 25.4;
    if (unit === 'ft' || unit === 'feet' || unit === "'") return value * 304.8;
    return value; // assume mm
  };
  
  const meas1 = getMeasurement(clean1);
  const meas2 = getMeasurement(clean2);
  
  if (meas1 && meas2 && Math.abs(meas1 - meas2) < 0.01) {
    return true;
  }
  
  // Shape equivalences
  const shapeGroups = [
    ['round', 'circular', 'circle'],
    ['square', 'squared'],
    ['rectangular', 'rectangle'],
    ['hexagonal', 'hexagon'],
    ['flat', 'flat bar'],
    ['angle', 'l shape', 'l-shaped'],
    ['channel', 'c shape', 'c-shaped'],
    ['pipe', 'tube', 'tubular'],
    ['slotted', 'slot'],
  ];
  
  for (const group of shapeGroups) {
    const inGroup1 = group.some(term => clean1.includes(term));
    const inGroup2 = group.some(term => clean2.includes(term));
    if (inGroup1 && inGroup2) return true;
  }
  
  return false;
}

export function compareResults(
  chatgptSpecs: Stage1Output,
  geminiSpecs: Stage1Output
): {
  common_specs: Array<{
    spec_name: string;
    chatgpt_name: string;
    gemini_name: string;
    common_options: string[];
    chatgpt_unique_options: string[];
    gemini_unique_options: string[];
  }>;
  chatgpt_unique_specs: Array<{ spec_name: string; options: string[] }>;
  gemini_unique_specs: Array<{ spec_name: string; options: string[] }>;
} {
  const chatgptAllSpecs = extractAllSpecsWithOptions(chatgptSpecs);
  const geminiAllSpecs = extractAllSpecsWithOptions(geminiSpecs);

  const commonSpecs: Array<{
    spec_name: string;
    chatgpt_name: string;
    gemini_name: string;
    common_options: string[];
    chatgpt_unique_options: string[];
    gemini_unique_options: string[];
  }> = [];

  const chatgptUnique: Array<{ spec_name: string; options: string[] }> = [];
  const geminiUnique: Array<{ spec_name: string; options: string[] }> = [];

  const matchedChatgpt = new Set<number>();
  const matchedGemini = new Set<number>();

  chatgptAllSpecs.forEach((chatgptSpec, i) => {
    let foundMatch = false;
    
    geminiAllSpecs.forEach((geminiSpec, j) => {
      if (matchedGemini.has(j)) return;
      
      if (isSemanticallySimilar(chatgptSpec.spec_name, geminiSpec.spec_name)) {
        matchedChatgpt.add(i);
        matchedGemini.add(j);
        foundMatch = true;
        
        const commonOpts = findCommonOptions(chatgptSpec.options, geminiSpec.options);
        const chatgptUniq = chatgptSpec.options.filter(opt => 
          !geminiSpec.options.some(gemOpt => isSemanticallySimilarOption(opt, gemOpt))
        );
        const geminiUniq = geminiSpec.options.filter(opt => 
          !chatgptSpec.options.some(chatOpt => isSemanticallySimilarOption(opt, chatOpt))
        );
        
        commonSpecs.push({
          spec_name: chatgptSpec.spec_name,
          chatgpt_name: chatgptSpec.spec_name,
          gemini_name: geminiSpec.spec_name,
          common_options: commonOpts,
          chatgpt_unique_options: chatgptUniq,
          gemini_unique_options: geminiUniq
        });
      }
    });
    
    if (!foundMatch) {
      chatgptUnique.push({
        spec_name: chatgptSpec.spec_name,
        options: chatgptSpec.options
      });
    }
  });

  geminiAllSpecs.forEach((geminiSpec, j) => {
    if (!matchedGemini.has(j)) {
      geminiUnique.push({
        spec_name: geminiSpec.spec_name,
        options: geminiSpec.options
      });
    }
  });

  return {
    common_specs: commonSpecs,
    chatgpt_unique_specs: chatgptUnique,
    gemini_unique_specs: geminiUnique,
  };
}

function extractAllSpecsWithOptions(specs: Stage1Output): Array<{ spec_name: string; options: string[] }> {
  const allSpecs: Array<{ spec_name: string; options: string[] }> = [];
  
  specs.seller_specs.forEach((ss) => {
    ss.mcats.forEach((mcat) => {
      const { finalized_primary_specs, finalized_secondary_specs, finalized_tertiary_specs } =
        mcat.finalized_specs;
      
      finalized_primary_specs.specs.forEach((s) => 
        allSpecs.push({ spec_name: s.spec_name, options: s.options })
      );
      finalized_secondary_specs.specs.forEach((s) => 
        allSpecs.push({ spec_name: s.spec_name, options: s.options })
      );
      finalized_tertiary_specs.specs.forEach((s) => 
        allSpecs.push({ spec_name: s.spec_name, options: s.options })
      );
    });
  });
  
  return allSpecs;
}

function isSemanticallySimilarOption(opt1: string, opt2: string): boolean {
  return areOptionsStronglySimilar(opt1, opt2);
}

function findCommonOptions(options1: string[], options2: string[]): string[] {
  const common: string[] = [];
  const usedIndices = new Set<number>();

  console.log(`🔍 Finding common options between:`);
  console.log(`   Stage 1: [${options1.join(', ')}]`);
  console.log(`   Stage 2: [${options2.join(', ')}]`);

  // First, check for direct matches and semantic matches
  options1.forEach((opt1) => {
    options2.forEach((opt2, j) => {
      if (usedIndices.has(j)) return;
      if (areOptionsStronglySimilar(opt1, opt2)) {
        common.push(opt1);
        usedIndices.add(j);
        console.log(`   ✅ Match: "${opt1}" ≈ "${opt2}"`);
      }
    });
  });

  // Second, check if Stage 2 has ranges and Stage 1 has discrete values
  options2.forEach((opt2, j) => {
    if (usedIndices.has(j)) return;

    const rangeMatch = opt2.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|inch|in)?/i);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      const unit = rangeMatch[3]?.toLowerCase() || '';

      console.log(`   📊 Found range in Stage 2: ${opt2} (${min}-${max} ${unit})`);

      // Check if any Stage 1 options fall within this range
      options1.forEach((opt1) => {
        const valueMatch = opt1.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|inch|in)?/i);
        if (valueMatch && !common.includes(opt1)) {
          const value = parseFloat(valueMatch[1]);
          const valueUnit = valueMatch[2]?.toLowerCase() || '';

          // Check if units match (if specified)
          const unitsMatch = !unit || !valueUnit || unit === valueUnit;

          if (unitsMatch && value >= min && value <= max) {
            common.push(opt1);
            console.log(`   ✅ Range match: "${opt1}" falls within "${opt2}"`);
          }
        }
      });

      usedIndices.add(j);
    }
  });

  console.log(`   📊 Found ${common.length} common options`);
  return common;
}

// Missing function from original code
function buildStage1Prompt(input: InputData): string {
  return `Stage 1 prompt for: ${JSON.stringify(input)}`;
}

function extractRawText(response: any): string {
  try {
    if (!response?.candidates?.length) return "";

    const parts = response.candidates[0]?.content?.parts || [];
    let text = "";

    for (const part of parts) {
      if (typeof part.text === "string") {
        text += part.text + "\n";
      }
    }

    return text.trim();
  } catch {
    return "";
  }
}
export async function findCommonSpecsWithGemini(
  stage1Specs: { spec_name: string; options: string[]; tier?: string }[],
  stage2ISQs: { config: ISQ; keys: ISQ[]; buyers?: ISQ[] }
): Promise<{ commonSpecs: Array<{ spec_name: string; options: string[]; category: string }> }> {
  console.log("🚀 Stage 3: Finding ALL common specifications...");

  // 1. FIRST use Gemini API
  console.log("🤖 First trying Gemini API...");
  const geminiResult = await findCommonSpecsWithGeminiAPI(stage1Specs, stage2ISQs);

  if (geminiResult.length > 0) {
    console.log(`✅ Gemini found ${geminiResult.length} common specs`);
    const dedupedSpecs = deduplicateCommonSpecs(geminiResult);
    console.log(`✅ After deduplication: ${dedupedSpecs.length} specs`);
    return { commonSpecs: dedupedSpecs };
  }

  // 2. If Gemini returns nothing, try local matching
  console.log("⚠️ Gemini found nothing, trying local matching...");
  const localResult = findCommonSpecsLocally(stage1Specs, stage2ISQs);
  const dedupedSpecs = deduplicateCommonSpecs(localResult);
  console.log(`✅ After deduplication: ${dedupedSpecs.length} specs`);

  return { commonSpecs: dedupedSpecs };
}

function deduplicateCommonSpecs(
  specs: Array<{ spec_name: string; options: string[]; category: string }>
): Array<{ spec_name: string; options: string[]; category: string }> {
  console.log("🚫 DEDUPLICATION DISABLED - Keeping all specs as they are");
  
  // Return specs as-is, only deduplicate options within each spec
  return specs.map(spec => ({
    spec_name: spec.spec_name,
    options: Array.from(new Set(spec.options.map(o => o.trim()).filter(o => o.length > 0))),
    category: spec.category
  }));
}

// Helper 1: Use Gemini API FIRST
async function findCommonSpecsWithGeminiAPI(
  stage1Specs: { spec_name: string; options: string[]; tier?: string }[],
  stage2ISQs: { config: ISQ; keys: ISQ[]; buyers?: ISQ[] }
): Promise<Array<{ spec_name: string; options: string[]; category: string }>> {
  if (!STAGE3_API_KEY) {
    console.warn("⚠️ Stage 3 API key not configured");
    return [];
  }

  // Flatten Stage 2 for Gemini
  const stage2All = [];
  if (stage2ISQs.config?.name) {
    stage2All.push({
      name: stage2ISQs.config.name,
      options: stage2ISQs.config.options || []
    });
  }
  if (stage2ISQs.keys?.length > 0) {
    stage2All.push(...stage2ISQs.keys.filter(k => k.name && k.options?.length > 0));
  }
  if (stage2ISQs.buyers?.length > 0) {
    stage2All.push(...stage2ISQs.buyers.filter(b => b.name && b.options?.length > 0));
  }

  const prompt = `You are an AI that finds COMMON specifications and common options between two data sources.

STAGE 1 SPECIFICATIONS (from uploaded data):
${stage1Specs.map((s, i) => `${i + 1}. ${s.spec_name} (${s.tier || 'Unknown'})
   Options: ${s.options.join(', ')}`).join('\n')}

STAGE 2 SPECIFICATIONS (from website data):
${stage2All.map((s, i) => `${i + 1}. ${s.name}
   Options: ${s.options.join(', ')}`).join('\n')}

IMPORTANT INSTRUCTIONS:
1. Find ALL specifications that exist in BOTH Stage 1 and Stage 2
2. CRITICAL: "Grade", "Standard", "Quality" are COMPLETELY DIFFERENT specifications - DO NOT treat them as the same
   - "Grade" refers to material grade (e.g., 304, 316, MS)
   - "Standard" refers to compliance standards (e.g., IS 2062, ASTM, EN)
   - "Quality" refers to quality level or class
   - These are SEPARATE specifications and must be matched ONLY by exact or very similar names  
3. Do not match one specification from one stage to multiple specifications from other stage, one specification should match with one specification only
4. For each common specification:
   - Use the EXACT "spec_name" from Stage 1
   - Use the category from Stage 1 (Primary/Secondary)
   - Find ALL common options between the two stages
   - If NO common options, show empty options list
   - If one stage has options **range** (e.g., "1-5 mm") and the other stage has **discrete numbers** (e.g., "1 mm, 2 mm, 3 mm"), treat all discrete numbers that fall within the range as common options
   - You MUST return the common options in format **exactly as it appears in the Stage 1 list**
   - For grades like "304" and "304L", these are DIFFERENT options - treat them separately
5. EVEN IF a common spec has ZERO common options, it MUST still be listed with an empty options column
6. Return ALL common specifications found - do NOT limit to 2 or any other number

CRITICAL RANGE HANDLING FOR COMMON OPTIONS:
1. If Stage 2 has a RANGE (e.g., "0.14-2.00 mm") and Stage 1 has SPECIFIC NUMBERS (e.g., "0.5 mm", "1.0 mm", "1.5 mm"):
   - Extract ALL specific numbers from Stage 1 that fall WITHIN the Stage 2 range
   - Example: Stage 2: "0.14-2.00 mm", Stage 1: ["0.5 mm", "1.0 mm", "1.5 mm", "2.5 mm"]
     → Common options: "0.5 mm", "1.0 mm", "1.5 mm", "2.0 mm" (all within 0.14-2.00 mm)
     → "2.5 mm" is NOT included (outside range)
   
2. If Stage 1 has a RANGE and Stage 2 has SPECIFIC NUMBERS:
   - Apply the same logic in reverse
   
3. If BOTH have RANGES:
   - Find the OVERLAPPING portion
   - Example: Stage 1: "0.5-1.5 mm", Stage 2: "1.0-2.0 mm"
     → Common range: "1.0-1.5 mm"
     → Report as: "1.0-1.5 mm"

4. For mixed units (mm, cm, inches):
   - Convert ALL to a common unit (prefer mm) before comparing
   - 1 inch = 25.4 mm, 1 cm = 10 mm


5. If Stage 2 has multiple overlapping ranges (like "0.14-2.00 mm" and "0.25-2.00 mm"):
   - Consider the WIDER range ("0.14-2.00 mm") for comparison
   - Remove redundant narrower ranges
  
OUTPUT FORMAT (PLAIN TEXT TABLE):
Specification Name | Stage 1 Category | Common Options
Grade | Primary | 304, 316, 430
Finish | Secondary |
Type | Primary | A, B, C

CRITICAL OUTPUT REQUIREMENTS:
1. Return ALL common specifications found in both stages - DO NOT LIMIT TO 2 OR ANY NUMBER
2. Each line represents ONE specification
3. Use pipe (|) to separate columns
4. EVEN IF a common spec has ZERO common options, it MUST still be listed with an empty options column
5. If NO common specs found, return empty table
6. List common options separated by commas (use exact format from Stage 1)
7. NO JSON, NO MARKDOWN, JUST PLAIN TEXT TABLE
8. Include ALL specifications that match between stages, not just the first few you find
9. For options like "304" and "304L", treat them as DIFFERENT - only mark as common if both stages have the EXACT same option`;

  try {
    console.log("📡 Calling Gemini API for common specs...");
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${STAGE3_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: "text/plain"
          }
        })
      },
      2,
      10000
    );

    const data = await response.json();
    console.log("✅ Gemini response received");

    const textResponse = extractRawText(data);
    console.log("📝 Gemini text response (first 500 chars):");
    console.log(textResponse.substring(0, 500));

    const result = parseCommonSpecsFromText(textResponse, stage1Specs);

    if (result && result.length > 0) {
      console.log(`🎉 Gemini found ${result.length} common specifications`);
      return result;
    }

    console.warn("⚠️ Gemini returned no valid data");
    return [];

  } catch (error) {
    console.error("❌ Gemini API error:", error);
    return [];
  }
}

function parseCommonSpecsFromText(
  text: string,
  stage1Specs: { spec_name: string; options: string[]; tier?: string }[]
): Array<{ spec_name: string; options: string[]; category: string }> {
  console.log("📊 Parsing common specs from text...");

  const result: Array<{ spec_name: string; options: string[]; category: string }> = [];
  const lines = text.split('\n').filter(line => line.trim().length > 0);

  for (const line of lines) {
    // Skip header lines
    if (line.toLowerCase().includes('specification') || 
        line.toLowerCase().includes('stage 1 category') ||
        line.includes('---') || 
        line.includes('===') ||
        line.includes('----')) {
      console.log(`   Skipping header: "${line.substring(0, 40)}..."`);
      continue;
    }

    // Split by pipe |
    const parts = line.split('|').map(p => p.trim());

    console.log(`   Parsing: "${line}"`);
    console.log(`   Parts (${parts.length}):`, parts);

    // Minimum 2 parts needed: spec name and something
    if (parts.length >= 2) {
      const specName = parts[0];
      
      // Find matching Stage 1 spec
      const stage1Match = stage1Specs.find(s =>
        s.spec_name === specName || isSemanticallySimilar(s.spec_name, specName)
      );

      if (!stage1Match) {
        console.log(`   ⚠️ No Stage 1 match for: "${specName}"`);
        continue;
      }

      let category = stage1Match.tier || 'Primary';
      let optionsStr = '';

      // Handle different cases
      if (parts.length === 2) {
        // Format: "Spec Name | options" OR "Spec Name | Category"
        const secondPart = parts[1].toLowerCase();
        
        if (['primary', 'secondary', 'tertiary'].includes(secondPart)) {
          // It's a category
          category = parts[1];
          optionsStr = '';
        } else {
          // It's options
          category = stage1Match.tier || 'Primary';
          optionsStr = parts[1];
        }
      } 
      else if (parts.length >= 3) {
        // Format: "Spec Name | Category | Options"
        category = parts[1];
        optionsStr = parts[2];
      }

      console.log(`   Category: ${category}, Options: "${optionsStr}"`);

      // Parse options
      const optionsList = parseOptionsSimple(optionsStr);
      
      console.log(`   Options parsed:`, optionsList);
      
      result.push({
        spec_name: stage1Match.spec_name,
        options: optionsList.length > 0 ? optionsList : ["No common options available"],
        category: category
      });
    }
  }

  console.log(`✅ Parsed ${result.length} common specs from text`);
  return result;
}

// SIMPLE options parser
function parseOptionsSimple(optionsStr: string): string[] {
  if (!optionsStr || optionsStr.trim().length === 0) {
    return [];
  }

  // Simple split by comma and trim
  return optionsStr
    .split(',')
    .map(opt => opt.trim())
    .filter(opt => opt.length > 0)
    .filter(opt => !opt.toLowerCase().includes('no common options'));
}
// Helper 2: Local matching if Gemini fails
function findCommonSpecsLocally(
  stage1Specs: { spec_name: string; options: string[]; tier?: string }[],
  stage2ISQs: { config: ISQ; keys: ISQ[]; buyers?: ISQ[] }
): Array<{ spec_name: string; options: string[]; category: string }> {
  console.log("🔍 Looking for common specs locally...");
  
  // Flatten Stage 2 specs
  const stage2All: { name: string; options: string[] }[] = [];
  
  // Add Config
  if (stage2ISQs.config?.name && stage2ISQs.config.options?.length > 0) {
    stage2All.push({
      name: stage2ISQs.config.name,
      options: stage2ISQs.config.options
    });
  }
  
  // Add Keys
  if (stage2ISQs.keys?.length > 0) {
    stage2All.push(...stage2ISQs.keys.filter(k => k.name && k.options?.length > 0));
  }
  
  // Add Buyers
  if (stage2ISQs.buyers?.length > 0) {
    stage2All.push(...stage2ISQs.buyers.filter(b => b.name && b.options?.length > 0));
  }
  
  const commonSpecs: Array<{ spec_name: string; options: string[]; category: string }> = [];
  
  stage1Specs.forEach(stage1Spec => {
    // Find matching spec in Stage 2
    const matchingStage2 = stage2All.find(stage2Spec => 
      isSemanticallySimilar(stage1Spec.spec_name, stage2Spec.name)
    );
    
    if (matchingStage2) {
      // Find common options
      const commonOptions = findCommonOptions(
        stage1Spec.options, 
        matchingStage2.options
      );
      
      // If no common options, add message
      const finalOptions = commonOptions.length > 0 
        ? commonOptions 
        : ["No common options available"];
      
      commonSpecs.push({
        spec_name: stage1Spec.spec_name,
        options: finalOptions,
        category: stage1Spec.tier === 'Primary' ? 'Primary' : 'Secondary'
      });
      
      console.log(`✅ Found local common: ${stage1Spec.spec_name} (${commonOptions.length} common options)`);
    }
  });
  
  console.log(`📊 Found ${commonSpecs.length} common specs locally`);
  return commonSpecs;
}

export async function generateBuyerISQsWithGemini(
  commonSpecs: Array<{ spec_name: string; options: string[]; category: string }>,
  stage1Specs: { spec_name: string; options: string[]; tier?: string }[]
): Promise<ISQ[]> {
  console.log('🚀 Stage 3: Generating Buyer ISQs with Gemini...');

  if (commonSpecs.length === 0) {
    console.log('⚠️ No common specs, no buyer ISQs');
    return [];
  }

  const topSpecs = commonSpecs.slice(0, 2);
  console.log(`📦 Taking first ${topSpecs.length} common specs for Buyer ISQs`);

  const buyerISQs: ISQ[] = [];

  for (const commonSpec of topSpecs) {
    console.log(`\n🔧 Processing Buyer ISQ: ${commonSpec.spec_name}`);

    const commonOptions = commonSpec.options.filter(opt =>
      !opt.toLowerCase().includes('no common options available')
    );

    console.log(`   Common options count: ${commonOptions.length}`);

    const stage1Spec = stage1Specs.find(s =>
      s.spec_name === commonSpec.spec_name ||
      isSemanticallySimilar(s.spec_name, commonSpec.spec_name)
    );

    if (!stage1Spec) {
      console.log(`   No matching Stage 1 spec found, using common options only`);
      const finalOptions = cleanBuyerISQOptions(commonOptions).slice(0, 8);
      buyerISQs.push({
        name: commonSpec.spec_name,
        options: finalOptions
      });
      continue;
    }

    console.log(`   Found Stage 1 spec with ${stage1Spec.options.length} options`);

    if (commonOptions.length >= 8) {
      console.log(`   Already have 8+ common options, using first 8`);
      const finalOptions = cleanBuyerISQOptions(commonOptions).slice(0, 8);
      buyerISQs.push({
        name: commonSpec.spec_name,
        options: finalOptions
      });
      continue;
    }

    console.log(`   Need more options (have ${commonOptions.length}), calling Gemini...`);

    const enhancedOptions = await enhanceOptionsWithGemini(
      commonSpec.spec_name,
      commonOptions,
      stage1Spec.options,
      8 - commonOptions.length
    );

    const finalOptions = cleanBuyerISQOptions([...commonOptions, ...enhancedOptions]).slice(0, 8);

    console.log(`   ✅ Final: ${finalOptions.length} options (${commonOptions.length} common + ${enhancedOptions.length} from Stage 1)`);

    buyerISQs.push({
      name: commonSpec.spec_name,
      options: finalOptions
    });
  }

  console.log(`\n🎉 Generated ${buyerISQs.length} Buyer ISQs`);
  buyerISQs.forEach((isq, i) => {
    console.log(`  ${i+1}. ${isq.name}: ${isq.options.length} options`);
  });

  // Remove duplicate specs with identical options
  const uniqueBuyerISQs = removeDuplicateISQs(buyerISQs);
  if (uniqueBuyerISQs.length < buyerISQs.length) {
    console.log(`🧹 Removed ${buyerISQs.length - uniqueBuyerISQs.length} duplicate Buyer ISQs with same options`);
  }

  return uniqueBuyerISQs;
}

function removeDuplicateISQs(isqs: ISQ[]): ISQ[] {
  const uniqueISQs: ISQ[] = [];
  const seenOptionSets = new Map<string, ISQ>();

  for (const isq of isqs) {
    // Create a signature from sorted options
    const optionsSignature = isq.options
      .map(opt => opt.toLowerCase().trim())
      .sort()
      .join('|||');

    // Check if we already have an ISQ with same options
    if (!seenOptionSets.has(optionsSignature)) {
      seenOptionSets.set(optionsSignature, isq);
      uniqueISQs.push(isq);
    } else {
      const existing = seenOptionSets.get(optionsSignature)!;
      console.log(`   Duplicate found: "${isq.name}" has same options as "${existing.name}"`);
    }
  }

  return uniqueISQs;
}

function deduplicateOptions(options: string[]): string[] {
  const uniqueOptions: string[] = [];
  const seenOptions = new Set<string>();

  for (const opt of options) {
    const optLower = opt.toLowerCase().trim();
    if (!seenOptions.has(optLower) && !isOptionDuplicate(opt, uniqueOptions)) {
      uniqueOptions.push(opt);
      seenOptions.add(optLower);
    }
  }

  return uniqueOptions;
}

function cleanBuyerISQOptions(options: string[]): string[] {
  const invalidPatterns = [
    'other',
    'others', 
    'various',
    'etc',
    'etc.',
    'and more',
    'miscellaneous',
    'misc',
    'other options',
    'other values',
    'additional',
    'extra',
    'custom',
    'specify',
    'please specify',
    'enter value',
    'fill in',
    'input required',
    'user defined',
    'customer defined',
    'user input',
    'input here',
    'to be specified',
    'tbd',
    't.b.d.',
    'to be determined',
    'to be decided',
    'select',
    'choose',
    'pick',
    'option',
    'options'
  ];

  const uniqueOptions: string[] = [];
  const seenOptions = new Set<string>();

  for (const opt of options) {
    const cleanOpt = opt.trim();
    if (cleanOpt.length === 0) continue;
    
    const optLower = cleanOpt.toLowerCase();
    
    // Check if it's an invalid option
    const isInvalid = invalidPatterns.some(pattern => 
      optLower === pattern || 
      optLower.startsWith(pattern + ' ') ||
      optLower.endsWith(' ' + pattern) ||
      optLower.includes(' ' + pattern + ' ')
    );
    
    if (isInvalid) {
      console.log(`   🗑️ Removing invalid option: "${opt}"`);
      continue;
    }
    
    // Check if it's a duplicate
    if (!seenOptions.has(optLower) && !isOptionDuplicate(opt, uniqueOptions)) {
      uniqueOptions.push(cleanOpt);
      seenOptions.add(optLower);
    }
  }

  return uniqueOptions;
}
async function enhanceOptionsWithGemini(
  specName: string,
  commonOptions: string[],
  stage1Options: string[],
  neededCount: number
): Promise<string[]> {
  if (!STAGE3_API_KEY) {
    console.warn('⚠️ Stage 3 API key not configured, using local fallback');
    return enhanceOptionsLocally(commonOptions, stage1Options, neededCount);
  }

  const prompt = `You are an AI that intelligently selects the most relevant product specification options.

SPECIFICATION NAME: "${specName}"

EXISTING OPTIONS (already selected):
${commonOptions.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

AVAILABLE STAGE 1 OPTIONS (to choose from):
${stage1Options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

TASK:
Select exactly ${neededCount} options from the Stage 1 options to add to the existing options.

CRITICAL RULES:
1. DO NOT select any option that is already in the existing options
2. DO NOT select options that are semantically the same as existing options
3. Select the MOST RELEVANT and COMMONLY USED options for "${specName}"
4. Prefer options that are industry-standard or widely used
5. Select exactly ${neededCount} options (no more, no less)
6. If fewer than ${neededCount} unique options are available, return as many as possible.
7. DO NOT include option "Other", "etc.".

EXAMPLES OF SEMANTIC DUPLICATES (DO NOT SELECT):
- If "304" exists, don't select "SS304", "ss304", "Stainless Steel 304"
- If "2mm" exists, don't select "2 mm", "2.0mm"
- If "Polished" exists, don't select "Polish", "Polished Finish"

OUTPUT FORMAT (JSON ONLY):
{
  "selected_options": ["option1", "option2", "option3"]
}

Return ONLY valid JSON, no explanations.`;

  try {
    console.log(`📡 Calling Gemini to select ${neededCount} additional options...`);
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${STAGE3_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: "application/json"
          }
        })
      },
      2,
      10000
    );

    const data = await response.json();
    const result = extractJSONFromGemini(data);

    if (result && result.selected_options && Array.isArray(result.selected_options)) {
      const validOptions = result.selected_options
        .filter(opt => typeof opt === 'string' && opt.trim().length > 0)
        .filter(opt => !isOptionDuplicate(opt, commonOptions))
        .slice(0, neededCount);

      console.log(`✅ Gemini selected ${validOptions.length} additional options`);
      return validOptions;
    }

    console.warn('⚠️ Gemini returned invalid data, using local fallback');
    return enhanceOptionsLocally(commonOptions, stage1Options, neededCount);

  } catch (error) {
    console.error('❌ Gemini API error:', error);
    return enhanceOptionsLocally(commonOptions, stage1Options, neededCount);
  }
}

function enhanceOptionsLocally(
  commonOptions: string[],
  stage1Options: string[],
  neededCount: number
): string[] {
  console.log(`🔄 Using local enhancement (need ${neededCount} options)`);

  const additionalOptions: string[] = [];

  for (const opt of stage1Options) {
    if (additionalOptions.length >= neededCount) break;

    if (!isOptionDuplicate(opt, [...commonOptions, ...additionalOptions])) {
      additionalOptions.push(opt);
    }
  }

  console.log(`✅ Local enhancement added ${additionalOptions.length} options`);
  return additionalOptions;
}

function isOptionDuplicate(option: string, existingOptions: string[]): boolean {
  const cleanOpt = option.trim().toLowerCase();

  return existingOptions.some(existing => {
    const cleanExisting = existing.trim().toLowerCase();
    if (cleanOpt === cleanExisting) return true;
    if (areOptionsStronglySimilar(option, existing)) return true;
    return false;
  });
}