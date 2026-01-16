# Data Dictionary
## Entertainment Industry Electric Chainhoist Database

**Version:** 2.3.0
**Last Updated:** 2026-01-16
**Maintained By:** Data Engineering Team

---

## Overview

This document defines all fields in the chainhoist product database, including data types, validation rules, and business definitions.

---

## Field Classification

| Tier | Description | Fields |
|------|-------------|--------|
| **Tier 1 (Required)** | Must be present for record to be valid | `id`, `manufacturer`, `model`, `source` |
| **Tier 2 (Critical)** | Core specifications for product utility | `loadCapacity`, `liftingSpeed`, `classification` |
| **Tier 3 (Important)** | Additional specifications | `motorPower`, `dutyCycle`, `weight`, `protectionClass` |
| **Tier 4 (Optional)** | Supplementary information | `images`, `pdfs`, `price`, `warranty` |

---

## Field Definitions

### Identification Fields

#### `id`
- **Type:** String
- **Required:** Yes
- **Description:** Unique identifier for the product, typically generated from manufacturer and model
- **Format:** `{manufacturer-slug}-{model-slug}`
- **Example:** `"demag-dc-pro-1000"`
- **Validation:** Must be unique, alphanumeric with hyphens, max 200 characters

#### `manufacturer`
- **Type:** String
- **Required:** Yes
- **Description:** Name of the company that manufactures the product
- **Example:** `"Demag"`, `"Columbus McKinnon"`, `"Chainmaster"`
- **Normalization:** Standardized names (e.g., "CM" → "Columbus McKinnon")
- **Validation:** Max 100 characters

#### `model`
- **Type:** String
- **Required:** Yes
- **Description:** Product model name or designation
- **Example:** `"DC-Pro"`, `"Lodestar"`, `"BGV-D8+"`
- **Normalization:** Common suffixes removed ("Hoist", "Chain Hoist", "Series")
- **Validation:** Max 200 characters

#### `series`
- **Type:** String
- **Required:** No
- **Description:** Product series or family name
- **Example:** `"Lodestar"`, `"Stagemaker SR"`, `"DC Series"`

---

### Specification Fields

#### `loadCapacity`
- **Type:** String
- **Required:** No (Tier 2 Critical)
- **Description:** Maximum safe working load the hoist can lift
- **Format:** `"{value} {unit} ({converted})"`
- **Units:** kg, lbs, tons
- **Example:** `"1000 kg (2205 lbs)"`, `"500 kg"`
- **Pattern:** `/^\d+(?:\.\d+)?\s*(?:kg|lbs?|tons?)(?:\s*\([^)]+\))?$/i`
- **Business Rule:** Primary specification for capacity matching

#### `capacityKg`
- **Type:** Number | null
- **Required:** No (Computed)
- **Description:** Numeric load capacity converted to kilograms
- **Derived From:** `loadCapacity`
- **Example:** `1000`, `500`, `2000`
- **Use Case:** Numeric filtering and sorting

#### `liftingSpeed`
- **Type:** String
- **Required:** No (Tier 2 Critical)
- **Description:** Rate at which the hoist raises/lowers loads
- **Format:** `"{value} {unit} ({converted})"`
- **Units:** m/min, ft/min, fpm, m/s
- **Example:** `"8 m/min (26 ft/min)"`, `"4 m/min"`
- **Pattern:** `/^\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:m\/min|ft\/min|fpm|m\/s)$/i`

#### `speedMMin`
- **Type:** Number | null
- **Required:** No (Computed)
- **Description:** Numeric lifting speed converted to meters per minute
- **Derived From:** `liftingSpeed`
- **Example:** `8`, `4`, `12`

#### `motorPower`
- **Type:** String
- **Required:** No (Tier 3 Important)
- **Description:** Power rating of the hoist motor
- **Format:** `"{value} {unit} ({converted})"`
- **Units:** kW, HP, W
- **Example:** `"1.5 kW (2.0 HP)"`, `"0.75 kW"`
- **Pattern:** `/^\d+(?:\.\d+)?\s*(?:kW|HP|W)(?:\s*\([^)]+\))?$/i`

#### `dutyCycle`
- **Type:** String
- **Required:** No (Tier 3 Important)
- **Description:** Operating duty rating indicating usage intensity
- **Standards:** FEM, ISO, CMAA
- **Example:** `"FEM 2m"`, `"M5"`, `"40% ED"`, `"H4"`
- **Pattern:** `/^(?:FEM\s*\d+[a-z]*m?|M[1-8]|\d+%?\s*ED|H[1-4]|ISO\s*M[1-8]).*$/i`

#### `weight`
- **Type:** String
- **Required:** No (Tier 3 Important)
- **Description:** Weight of the hoist unit itself
- **Units:** kg, lbs
- **Example:** `"45 kg"`, `"100 lbs"`

#### `protectionClass`
- **Type:** String
- **Required:** No (Tier 3 Important)
- **Description:** IP (Ingress Protection) rating
- **Format:** `"IP{2 digits}"`
- **Example:** `"IP54"`, `"IP55"`, `"IP65"`
- **Pattern:** `/^IP\d{2}[A-Z]?$/i`

---

### Classification Fields

#### `classification`
- **Type:** Array of Strings
- **Required:** No (Tier 2 Critical)
- **Description:** Industry safety/compliance standards the hoist meets
- **Values:**
  - `"d8"` - BGV-D8 standard for entertainment lifting
  - `"d8+"` - BGV-D8+ enhanced standard
  - `"bgv-c1"` - BGV-C1 industrial standard
  - `"ansi"` - ANSI/ASME American standard
  - `"ce"` - European CE marking
  - `"atex"` - Explosive atmosphere certification
- **Example:** `["d8", "ce"]`, `["d8+", "ansi"]`
- **Normalization:** Lowercase, aliases resolved (e.g., "bgv-d8" → "d8")

#### `category`
- **Type:** String
- **Required:** No
- **Description:** Product category type
- **Values:** `"Electric Chain Hoist"`, `"Manual Hoist"`, `"Wire Rope Hoist"`
- **Default:** `"Unknown"`

#### `speedType`
- **Type:** String
- **Required:** No
- **Description:** Speed control capability
- **Values:** `"Variable Speed"`, `"Fixed Speed"`, `"Unknown"`

---

### Source Tracking Fields

#### `source`
- **Type:** String
- **Required:** Yes (Tier 1)
- **Description:** Origin of the record data
- **Values:**
  - `"scraped"` - Web scraping
  - `"manual"` - Manual data entry
  - `"llm_enriched"` - LLM extraction
  - `"merged"` - Multiple sources combined
  - `"unknown"` - Source not determined
- **Example:** `"scraped"`

#### `sourceUrl`
- **Type:** String | null
- **Required:** No
- **Description:** URL from which data was scraped
- **Format:** Valid URL
- **Example:** `"https://www.demag.com/products/dc-pro"`

#### `processedAt`
- **Type:** ISO 8601 DateTime String
- **Required:** Yes (Auto-generated)
- **Description:** Timestamp when record was last processed
- **Example:** `"2026-01-16T15:30:00.000Z"`

---

### Data Quality Fields

#### `dataCompleteness`
- **Type:** Number (0-100)
- **Required:** Yes (Computed)
- **Description:** Percentage score indicating how complete the record is
- **Calculation:** Weighted average of critical (70%) and secondary (30%) field presence
- **Example:** `75`, `42`, `100`

#### `dataQualityTier`
- **Type:** String
- **Required:** Yes (Computed)
- **Description:** Quality classification based on completeness
- **Values:**
  - `"complete"` - ≥80% completeness
  - `"partial"` - 60-79% completeness
  - `"incomplete"` - 30-59% completeness
  - `"minimal"` - <30% completeness

#### `hasCompleteSpecs`
- **Type:** Boolean
- **Required:** Yes (Computed)
- **Description:** Whether all critical specification fields are present
- **Fields Checked:** `loadCapacity`, `liftingSpeed`, `motorPower`

#### `populatedFields`
- **Type:** Array of Strings
- **Required:** Yes (Computed)
- **Description:** List of critical fields that have valid data
- **Example:** `["loadCapacity", "liftingSpeed"]`

#### `missingFields`
- **Type:** Array of Strings
- **Required:** Yes (Computed)
- **Description:** List of critical fields that are missing
- **Example:** `["motorPower", "classification"]`

---

### Media Fields

#### `images`
- **Type:** Array of Objects
- **Required:** No (Tier 4)
- **Description:** Product images
- **Object Structure:**
  ```json
  {
    "url": "/media/images/demag_dc-pro_0.webp",
    "alt": "Demag DC-Pro",
    "localPath": "demag_dc-pro_0.webp"
  }
  ```

#### `pdfs`
- **Type:** Array of Objects
- **Required:** No (Tier 4)
- **Description:** Product documentation PDFs
- **Object Structure:**
  ```json
  {
    "url": "https://example.com/datasheet.pdf",
    "title": "DC-Pro Datasheet",
    "localPath": "demag_dc-pro_datasheet.pdf"
  }
  ```

---

### Entertainment Industry Fields

#### `quietOperation`
- **Type:** Boolean
- **Required:** No
- **Description:** Whether hoist is designed for quiet operation (theater use)
- **Default:** `false`

#### `dynamicLifting`
- **Type:** Boolean
- **Required:** No
- **Description:** Whether hoist supports dynamic/moving loads
- **Default:** `false`

#### `liftingOverPeople`
- **Type:** Boolean
- **Required:** No
- **Description:** Whether hoist is certified for lifting loads over people
- **Default:** `false`
- **Related:** Usually requires D8+ classification

---

### Enrichment Tracking Fields

#### `llmEnriched`
- **Type:** Boolean
- **Required:** No
- **Description:** Whether record has been enriched by LLM analysis
- **Default:** `false`

#### `llmEnrichedAt`
- **Type:** ISO 8601 DateTime String | null
- **Required:** No
- **Description:** Timestamp of LLM enrichment

#### `_manuallyEnriched`
- **Type:** Boolean
- **Required:** No
- **Description:** Whether record has manual data additions
- **Note:** Underscore prefix indicates internal/metadata field

#### `_manualEnrichmentFields`
- **Type:** Array of Strings
- **Required:** No
- **Description:** Fields that were manually added/modified

---

## Quality Gates

The following quality gates are enforced during data processing:

| Gate | Threshold | Description |
|------|-----------|-------------|
| Minimum Records | ≥10 | Database must have at least 10 valid records |
| Missing Load Capacity | ≤80% | No more than 80% of records can be missing loadCapacity |
| Missing Lifting Speed | ≤85% | No more than 85% of records can be missing liftingSpeed |
| Missing Motor Power | ≤95% | No more than 95% of records can be missing motorPower |
| Missing Classification | ≤50% | No more than 50% of records can be missing classification |
| Source Tracking | ≥90% | At least 90% of records must have source field populated |

---

## Data Lineage

### Processing Pipeline

```
Raw Scraped Data
      ↓
  Validation (Joi Schema)
      ↓
  Normalization (units, names)
      ↓
  Enrichment (LLM, PDF, Manual)
      ↓
  Quality Gates Check
      ↓
  Processed Database
```

### Source Priority

When multiple sources provide conflicting data:
1. Manual entry (highest priority)
2. LLM extraction from PDF
3. LLM extraction from images
4. Web scraping (lowest priority)

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-16 | 1.0 | Initial data dictionary created |

