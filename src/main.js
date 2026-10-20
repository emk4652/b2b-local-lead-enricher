import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

/**
 * Dual-mode runtime wrapper:
 * Uses official Apify SDK in production container or falls back to local filesystem runtime
 * when tested directly without node_modules installed.
 */
async function getRuntime() {
    try {
        const { Actor } = await import('apify');
        await Actor.init();
        return {
            isApify: true,
            getInput: async () => (await Actor.getInput()) || {},
            pushData: async (item) => {
                try {
                    await Actor.pushData(item, 'lead-enriched');
                } catch {
                    await Actor.pushData(item);
                }
            },
            charge: async (eventName, count = 1) => {
                if (typeof Actor.charge === 'function') {
                    try {
                        await Actor.charge({ eventName, count });
                    } catch {
                        // Ignore if PPE not active in current run mode
                    }
                }
            },
            exit: async () => Actor.exit(),
        };
    } catch {
        const inputPath = path.resolve(process.cwd(), 'INPUT.json');
        const localInput = fs.existsSync(inputPath)
            ? JSON.parse(fs.readFileSync(inputPath, 'utf8'))
            : {
                  urls: ['https://apify.com'],
                  crawlContactPages: false,
                  maxContactPagesPerDomain: 1,
                  detectTechStack: true,
                  requestTimeoutSecs: 12,
              };
        const outDir = path.resolve(process.cwd(), 'storage', 'datasets', 'default');
        fs.mkdirSync(outDir, { recursive: true });
        let counter = 1;
        return {
            isApify: false,
            getInput: async () => localInput,
            pushData: async (item) => {
                const file = path.join(outDir, `${String(counter++).padStart(9, '0')}.json`);
                fs.writeFileSync(file, JSON.stringify(item, null, 2), 'utf8');
            },
            charge: async () => {},
            exit: async () => {},
        };
    }
}

const TECH_SIGNATURES = [
    { name: 'Shopify', category: 'Ecommerce', regex: /cdn\.shopify\.com|Shopify\.theme/i },
    { name: 'WooCommerce', category: 'Ecommerce', regex: /woocommerce|wc-cart-fragments/i },
    { name: 'WordPress', category: 'CMS', regex: /wp-content|wp-includes/i },
    { name: 'Webflow', category: 'CMS', regex: /webflow\.com|data-wf-site/i },
    { name: 'Next.js', category: 'Framework', regex: /_next\/static|__NEXT_DATA__/i },
    { name: 'Nuxt.js', category: 'Framework', regex: /_nuxt\/|__NUXT__/i },
    { name: 'HubSpot', category: 'CRM & Marketing', regex: /js\.hs-scripts\.com|hs-analytics|hubspot/i },
    { name: 'Salesforce', category: 'CRM & Marketing', regex: /salesforce\.com|pardot\.com/i },
    { name: 'Intercom', category: 'Customer Support', regex: /widget\.intercom\.io|Intercom\(/i },
    { name: 'Zendesk', category: 'Customer Support', regex: /zdassets\.com|zendesk/i },
    { name: 'Crisp Chat', category: 'Customer Support', regex: /client\.crisp\.chat/i },
    { name: 'Stripe', category: 'Payments', regex: /js\.stripe\.com/i },
    { name: 'PayPal', category: 'Payments', regex: /paypalobjects\.com|paypal\.com\/sdk/i },
    { name: 'Google Tag Manager', category: 'Analytics', regex: /googletagmanager\.com\/gtm\.js/i },
    { name: 'Google Analytics 4', category: 'Analytics', regex: /googletagmanager\.com\/gtag\/js|G-[A-Z0-9]{6,12}/i },
    { name: 'Meta Pixel', category: 'Ads & Retargeting', regex: /connect\.facebook\.net\/.*\/fbevents\.js/i },
    { name: 'Cloudflare', category: 'CDN & Security', regex: /cdnjs\.cloudflare\.com|__cf_bm|cf-ray/i },
    { name: 'Segment', category: 'Analytics', regex: /cdn\.segment\.com\/analytics\.js/i },
    { name: 'Hotjar', category: 'Analytics', regex: /static\.hotjar\.com/i },
    { name: 'Klaviyo', category: 'CRM & Marketing', regex: /static\.klaviyo\.com/i },
];

const IGNORED_EMAIL_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.js', '.css', '.woff', '.woff2', '.ttf'];

function extractEmails(html) {
    const found = new Set();
    const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12})/gi;
    let match;
    while ((match = mailtoRegex.exec(html)) !== null) {
        found.add(match[1].toLowerCase().trim());
    }

    const rawEmailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}\b/g;
    const rawMatches = html.match(rawEmailRegex) || [];
    for (const raw of rawMatches) {
        const clean = raw.toLowerCase().trim();
        const isAsset = IGNORED_EMAIL_EXTENSIONS.some((ext) => clean.endsWith(ext));
        const isPlaceholder =
            clean.includes('example.com') ||
            clean.includes('yourdomain') ||
            clean.includes('sentry.io') ||
            clean.includes('wixpress.com');
        if (!isAsset && !isPlaceholder) {
            found.add(clean);
        }
    }
    return Array.from(found);
}

function extractPhones(html) {
    const found = new Set();
    const telRegex = /tel:([+\d\s().-]{7,22})/gi;
    let match;
    while ((match = telRegex.exec(html)) !== null) {
        const cleaned = match[1].replace(/[^\d+]/g, '');
        if (cleaned.length >= 8 && cleaned.length <= 16) {
            found.add(cleaned);
        }
    }

    const textOnly = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    const phoneRegex = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}/g;
    const candidates = textOnly.match(phoneRegex) || [];
    for (const candidate of candidates) {
        const normalized = candidate.replace(/[^\d+]/g, '');
        if (normalized.length >= 9 && normalized.length <= 15 && !/^(\d)\1+$/.test(normalized)) {
            found.add(normalized);
        }
    }
    return Array.from(found).slice(0, 10);
}

function extractSocialProfiles(html) {
    const profiles = {
        linkedin: null,
        twitter: null,
        instagram: null,
        facebook: null,
        youtube: null,
        github: null,
    };

    const patterns = {
        linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i,
        twitter: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/(?!intent|share)[a-zA-Z0-9_]{2,40}/i,
        instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/)[a-zA-Z0-9._]{2,40}/i,
        facebook: /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|tr\?)[a-zA-Z0-9._-]{2,60}/i,
        youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)[a-zA-Z0-9_-]+/i,
        github: /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_-]+/i,
    };

    for (const [network, regex] of Object.entries(patterns)) {
        const match = html.match(regex);
        if (match) {
            profiles[network] = match[0];
        }
    }
    return profiles;
}

function extractMetadataAndSchema(html) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;

    const descMatch =
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const description = descMatch ? descMatch[1].trim() : null;

    const jsonLdBlocks = [];
    const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            jsonLdBlocks.push(parsed);
        } catch {
            // Skip malformed JSON-LD blocks
        }
    }

    let organizationName = null;
    let address = null;
    for (const block of jsonLdBlocks) {
        const items = Array.isArray(block) ? block : block['@graph'] ? block['@graph'] : [block];
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if (!organizationName && item.name && typeof item.name === 'string') {
                organizationName = item.name;
            }
            if (!address && item.address && typeof item.address === 'object') {
                address = [
                    item.address.streetAddress,
                    item.address.addressLocality,
                    item.address.addressRegion,
                    item.address.postalCode,
                    item.address.addressCountry,
                ]
                    .filter(Boolean)
                    .join(', ');
            }
        }
    }

    return {
        companyName: organizationName || (title ? title.split(/[|-]/)[0].trim() : null),
        pageTitle: title,
        metaDescription: description,
        address,
    };
}

function detectTech(html, headersObj = {}) {
    const detected = [];
    const combinedContext = `${html}\n${JSON.stringify(headersObj)}`;
    for (const sig of TECH_SIGNATURES) {
        if (sig.regex.test(combinedContext)) {
            detected.push({
                name: sig.name,
                category: sig.category,
            });
        }
    }
    return detected;
}

function findInternalContactLinks(html, baseUrl, limit = 2) {
    const links = new Set();
    const hrefRegex = /href=["']([^"'#]+)["']/gi;
    const contactKeywords = /\/(contact|contacto|about|nosotros|impressum|legal|team|company)/i;
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
        if (links.size >= limit) break;
        const rawHref = match[1].trim();
        if (!contactKeywords.test(rawHref)) continue;
        try {
            const resolved = new URL(rawHref, baseUrl);
            const baseHost = new URL(baseUrl).hostname;
            if (resolved.hostname === baseHost && ['http:', 'https:'].includes(resolved.protocol)) {
                links.add(resolved.href);
            }
        } catch {
            // Ignore invalid URLs
        }
    }
    return Array.from(links).slice(0, limit);
}

async function fetchHtml(targetUrl, timeoutSecs = 15) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSecs * 1000);
    try {
        const res = await fetch(targetUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
            },
        });
        const html = await res.text();
        const headersObj = {};
        res.headers.forEach((v, k) => {
            headersObj[k] = v;
        });
        return { ok: res.ok, status: res.status, html, headers: headersObj, finalUrl: res.url };
    } finally {
        clearTimeout(timer);
    }
}

function computeLeadScore({ emails, phones, socialProfiles, techStack, metaDescription }) {
    let score = 15;
    if (emails.length > 0) score += 35;
    if (phones.length > 0) score += 20;
    const activeSocials = Object.values(socialProfiles).filter(Boolean).length;
    score += Math.min(activeSocials * 5, 15);
    if (techStack.length > 0) score += 10;
    if (metaDescription) score += 5;
    return Math.min(score, 100);
}

async function run() {
    const runtime = await getRuntime();
    const input = await runtime.getInput();

    const urls = Array.isArray(input.urls) && input.urls.length > 0 ? input.urls : ['https://apify.com'];
    const crawlContactPages = input.crawlContactPages !== false;
    const maxContactPagesPerDomain = Number.isInteger(input.maxContactPagesPerDomain) ? input.maxContactPagesPerDomain : 2;
    const detectTechStack = input.detectTechStack !== false;
    const requestTimeoutSecs = Number(input.requestTimeoutSecs) || 15;

    console.log(`[B2B-Lead-Enricher] Starting enrichment for ${urls.length} target URL(s)...`);

    for (const rawUrl of urls) {
        const targetUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
        let domain = targetUrl;
        try {
            domain = new URL(targetUrl).hostname.replace(/^www\./, '');
        } catch {
            // Keep fallback string
        }

        try {
            const primary = await fetchHtml(targetUrl, requestTimeoutSecs);
            const emailsSet = new Set(extractEmails(primary.html));
            const phonesSet = new Set(extractPhones(primary.html));
            const socials = extractSocialProfiles(primary.html);
            const meta = extractMetadataAndSchema(primary.html);
            const techStack = detectTechStack ? detectTech(primary.html, primary.headers) : [];
            const visitedSubpages = [];

            if (crawlContactPages && maxContactPagesPerDomain > 0) {
                const sublinks = findInternalContactLinks(primary.html, primary.finalUrl || targetUrl, maxContactPagesPerDomain);
                for (const subUrl of sublinks) {
                    try {
                        const subRes = await fetchHtml(subUrl, requestTimeoutSecs);
                        visitedSubpages.push(subUrl);
                        for (const e of extractEmails(subRes.html)) emailsSet.add(e);
                        for (const p of extractPhones(subRes.html)) phonesSet.add(p);
                        const subSocials = extractSocialProfiles(subRes.html);
                        for (const [k, v] of Object.entries(subSocials)) {
                            if (!socials[k] && v) socials[k] = v;
                        }
                    } catch {
                        // Continue if subpage times out
                    }
                }
            }

            const emails = Array.from(emailsSet);
            const phones = Array.from(phonesSet);
            const leadQualityScore = computeLeadScore({
                emails,
                phones,
                socialProfiles: socials,
                techStack,
                metaDescription: meta.metaDescription,
            });

            const record = {
                domain,
                url: primary.finalUrl || targetUrl,
                httpStatus: primary.status,
                companyName: meta.companyName || domain,
                pageTitle: meta.pageTitle,
                metaDescription: meta.metaDescription,
                physicalAddress: meta.address,
                emails,
                phones,
                socialProfiles: socials,
                techStack,
                crawledContactPages: visitedSubpages,
                leadQualityScore,
                scrapedAt: new Date().toISOString(),
            };

            await runtime.pushData(record);
            await runtime.charge('lead-enriched', 1);
            console.log(
                `[B2B-Lead-Enricher] Enriched ${domain} | Score: ${leadQualityScore}/100 | Emails: ${emails.length} | Tech: ${techStack.length}`
            );
        } catch (err) {
            const errorRecord = {
                domain,
                url: targetUrl,
                error: err.message || 'Network or parsing failure',
                scrapedAt: new Date().toISOString(),
            };
            await runtime.pushData(errorRecord);
            console.error(`[B2B-Lead-Enricher] Error processing ${targetUrl}: ${err.message}`);
        }
    }

    await runtime.exit();
}

run();
