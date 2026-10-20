# B2B Local Lead Enricher & Tech Stack Scanner

Extracts commercial contact records, verified corporate emails, phone numbers, social media profiles, JSON-LD schema organization metadata, and front-end technology stacks from any list of company URLs.

## Core Capabilities

- **Contact Discovery**: Parses primary landing pages and automatically traverses internal `/contact`, `/about`, and `/legal` pages to capture executive and sales emails (`mailto:` and raw text patterns) and phone numbers.
- **Tech Stack Fingerprinting**: Identifies 20+ high-value B2B technology signatures across Ecommerce (Shopify, WooCommerce), CRM (HubSpot, Salesforce, Klaviyo), Customer Support (Intercom, Zendesk, Crisp), Payments (Stripe, PayPal), and Analytics (GA4, GTM, Meta Pixel, Segment, Hotjar).
- **Structured Entity Extraction**: Reads `application/ld+json` Schema.org graphs to extract official legal names and physical headquarters addresses.
- **Lead Scoring (0-100)**: Calculates an objective readiness score for outbound sales prioritization and CRM ingestion (HubSpot, Pipedrive, Clay, Make, n8n).

## Input Configuration

```json
{
  "urls": [
    "https://apify.com",
    "https://stripe.com"
  ],
  "crawlContactPages": true,
  "maxContactPagesPerDomain": 2,
  "detectTechStack": true,
  "requestTimeoutSecs": 15
}
```

## Output Dataset Example

```json
{
  "domain": "apify.com",
  "url": "https://apify.com/",
  "httpStatus": 200,
  "companyName": "Apify",
  "pageTitle": "Apify: Full-stack web scraping and data extraction platform",
  "metaDescription": "Cloud platform for web scraping, browser automation, and data for AI.",
  "physicalAddress": null,
  "emails": ["hello@apify.com"],
  "phones": [],
  "socialProfiles": {
    "linkedin": "https://www.linkedin.com/company/apify",
    "twitter": "https://x.com/apify",
    "instagram": null,
    "facebook": null,
    "youtube": "https://www.youtube.com/@apify",
    "github": "https://github.com/apify"
  },
  "techStack": [
    { "name": "Next.js", "category": "Framework" },
    { "name": "Intercom", "category": "Customer Support" },
    { "name": "Google Tag Manager", "category": "Analytics" }
  ],
  "crawledContactPages": ["https://apify.com/contact"],
  "leadQualityScore": 80,
  "scrapedAt": "2026-10-20T11:35:00.000Z"
}
```
