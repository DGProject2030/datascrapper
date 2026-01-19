const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const PDF_DIR = path.join(__dirname, 'chainhoist_data', 'media', 'pdfs');
const DB_PATH = path.join(__dirname, 'chainhoist_data', 'chainhoist_database.json');

// Regex patterns for dimensions
const dimensionPatterns = [
  // LxWxH format with units
  /dimensions?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in|inch|inches|")/gi,
  // L x W x H with labels
  /(\d+(?:\.\d+)?)\s*(mm|cm|m|in)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in)/gi,
  // Size: format
  /size\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]?\s*(\d+(?:\.\d+)?)?\s*(mm|cm|m|in)?/gi,
  // Length/Width/Height individual
  /length\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in)/gi,
  /width\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in)/gi,
  /height\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in)/gi,
  // Headroom (common in hoists)
  /headroom\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|in|")/gi,
  // Overall dimensions
  /overall\s+dimensions?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]?\s*(\d+(?:\.\d+)?)?\s*(mm|cm|m)?/gi,
  // German format (Abmessungen)
  /abmessungen\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]?\s*(\d+(?:\.\d+)?)?\s*(mm|cm|m)?/gi,
  // Maße (German for dimensions)
  /ma[ßs]e\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]?\s*(\d+(?:\.\d+)?)?\s*(mm|cm|m)?/gi,
];

// Weight patterns
const weightPatterns = [
  /weight\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|lbs?|pounds?)/gi,
  /net\s+weight\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|lbs?)/gi,
  /mass\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|lbs?)/gi,
  /gewicht\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|lbs?)/gi, // German
  /(\d+(?:\.\d+)?)\s*(kg|lbs?)\s*(?:net|gross)?/gi,
];

async function extractFromPdf(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;

    const results = {
      dimensions: [],
      weights: [],
      rawMatches: []
    };

    // Extract dimensions
    for (const pattern of dimensionPatterns) {
      pattern.lastIndex = 0; // Reset regex
      let match;
      while ((match = pattern.exec(text)) !== null) {
        results.dimensions.push(match[0].trim());
        results.rawMatches.push({ type: 'dimension', match: match[0].trim() });
      }
    }

    // Extract weights
    for (const pattern of weightPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const weightStr = match[0].trim();
        // Filter out clearly wrong matches (like years or model numbers)
        if (!weightStr.match(/19\d{2}|20\d{2}/)) {
          results.weights.push(weightStr);
          results.rawMatches.push({ type: 'weight', match: weightStr });
        }
      }
    }

    return results;
  } catch (err) {
    console.error(`Error parsing ${pdfPath}: ${err.message}`);
    return null;
  }
}

function getProductIdFromPdfName(pdfName) {
  // Convert PDF filename to product ID
  // e.g., "abus_abucompact-gm2_document_0.pdf" -> "abus-abucompact-gm2"
  const parts = pdfName.replace('.pdf', '').split('_');
  if (parts.length >= 2) {
    const manufacturer = parts[0];
    const model = parts[1];
    return `${manufacturer}-${model}`;
  }
  return null;
}

async function main() {
  console.log('PDF Dimension Extraction Tool');
  console.log('=============================\n');

  // Load database
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const products = db.data;
  console.log(`Loaded ${products.length} products from database\n`);

  // Create product lookup by ID
  const productLookup = {};
  products.forEach(p => {
    productLookup[p.id] = p;
  });

  // Get all PDFs
  const pdfFiles = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
  console.log(`Found ${pdfFiles.length} PDF files\n`);

  // Process PDFs
  let processedCount = 0;
  let dimensionsFound = 0;
  let weightsFound = 0;
  let updatedProducts = 0;

  const extractedData = {};

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(PDF_DIR, pdfFile);
    const productId = getProductIdFromPdfName(pdfFile);

    process.stdout.write(`Processing ${pdfFile}...`);

    const results = await extractFromPdf(pdfPath);

    if (results) {
      processedCount++;

      if (results.dimensions.length > 0 || results.weights.length > 0) {
        if (!extractedData[productId]) {
          extractedData[productId] = { dimensions: [], weights: [], pdfFiles: [] };
        }
        extractedData[productId].dimensions.push(...results.dimensions);
        extractedData[productId].weights.push(...results.weights);
        extractedData[productId].pdfFiles.push(pdfFile);

        if (results.dimensions.length > 0) {
          dimensionsFound++;
        }
        if (results.weights.length > 0) {
          weightsFound++;
        }

        console.log(` Found ${results.dimensions.length} dimensions, ${results.weights.length} weights`);
      } else {
        console.log(' No data found');
      }
    } else {
      console.log(' Error');
    }
  }

  console.log('\n=============================');
  console.log('EXTRACTION SUMMARY');
  console.log('=============================');
  console.log(`PDFs processed: ${processedCount}/${pdfFiles.length}`);
  console.log(`PDFs with dimensions: ${dimensionsFound}`);
  console.log(`PDFs with weights: ${weightsFound}`);
  console.log(`Unique products with data: ${Object.keys(extractedData).length}`);

  // Update products with extracted data
  console.log('\nUpdating products...');

  for (const [productId, data] of Object.entries(extractedData)) {
    // Find matching products (may match multiple due to partial ID match)
    const matchingProducts = products.filter(p =>
      p.id === productId ||
      p.id.startsWith(productId + '-') ||
      productId.startsWith(p.id.split('-').slice(0, 2).join('-'))
    );

    for (const product of matchingProducts) {
      let updated = false;

      // Update dimensions if not already set or is placeholder
      if (data.dimensions.length > 0) {
        const currentDim = product.dimensions || '';
        if (!currentDim || currentDim.includes('Not specified') || currentDim.includes('Not visible') || currentDim.length < 5) {
          // Get the most complete dimension string
          const bestDimension = data.dimensions
            .filter(d => d.length > 10) // Filter out short matches
            .sort((a, b) => b.length - a.length)[0];

          if (bestDimension) {
            product.dimensions = bestDimension;
            updated = true;
            console.log(`  Updated dimensions for ${product.id}: ${bestDimension}`);
          }
        }
      }

      // Update weight if not already set
      if (data.weights.length > 0) {
        const currentWeight = product.weight || '';
        if (!currentWeight || currentWeight.includes('Not specified') || currentWeight.length < 3) {
          // Get the most likely weight (prefer kg)
          const bestWeight = data.weights
            .filter(w => w.match(/\d+(?:\.\d+)?\s*kg/i))
            .sort((a, b) => b.length - a.length)[0] || data.weights[0];

          if (bestWeight) {
            product.weight = bestWeight;
            updated = true;
            console.log(`  Updated weight for ${product.id}: ${bestWeight}`);
          }
        }
      }

      if (updated) {
        updatedProducts++;
      }
    }
  }

  // Save updated database
  db.stats.pdfExtractedAt = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

  console.log('\n=============================');
  console.log('UPDATE SUMMARY');
  console.log('=============================');
  console.log(`Products updated: ${updatedProducts}`);
  console.log(`Database saved to ${DB_PATH}`);

  // Save extraction report
  const reportPath = path.join(__dirname, 'chainhoist_data_processed', 'pdf_extraction_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    extractedAt: new Date().toISOString(),
    pdfsProcessed: processedCount,
    pdfsWithDimensions: dimensionsFound,
    pdfsWithWeights: weightsFound,
    productsUpdated: updatedProducts,
    extractedData: extractedData
  }, null, 2));
  console.log(`Extraction report saved to ${reportPath}`);
}

main().catch(console.error);
