export const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["documentTitle", "effectiveDate", "summary", "findings", "limitations"],
  properties: {
    documentTitle: { type: "string" },
    effectiveDate: { type: ["string", "null"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "blockId",
          "classification",
          "severity",
          "category",
          "title",
          "originalQuote",
          "plainEnglish",
          "whyItMatters",
          "suggestedAction",
          "confidence"
        ],
        properties: {
          blockId: { type: "string" },
          classification: {
            type: "string",
            enum: ["concern", "caution", "positive", "neutral"]
          },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: { type: "string" },
          title: { type: "string" },
          originalQuote: { type: "string" },
          plainEnglish: { type: "string" },
          whyItMatters: { type: "string" },
          suggestedAction: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    limitations: { type: "array", items: { type: "string" }, maxItems: 8 }
  }
};
