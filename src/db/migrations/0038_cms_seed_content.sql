-- 0038_cms_seed_content.sql
-- Seed the CMS with default public-site content so the landing page, about,
-- services and FAQ sections render before any platform editor publishes their
-- own content. Public pages fall back to these rows (and, beyond these, to
-- hardcoded defaults in the client).
--
-- All of these inserts are idempotent on slug. If platform admins have already
-- created content for a slug, we do NOT overwrite it.

INSERT INTO cms_site_settings (
    id, site_name, site_tagline, primary_color, accent_color, contact_email,
    contact_phone, address, social_links, hero_section
)
SELECT
    gen_random_uuid(),
    'GovFleet Namibia',
    'Government, Municipalities, Mines, Logistics and Private Fleets',
    '#1F4E8C',
    '#0F766E',
    'fleetmanagement@grn.gov.na',
    '+264 61 208 9111',
    'P.O. Box 12020, Ausspannplatz, Windhoek, Namibia',
    '{"linkedin":"https://www.linkedin.com","twitter":"https://twitter.com"}',
    '{"title":"Digital Fleet Management for Every Organisation","subtitle":"Government, Municipalities, Mines, Logistics and Private Fleets","description":"GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocation, inspections, fuel records, trip logs, maintenance and trip closure with one secure and traceable digital workflow.","ctaLabel":"Access Dashboard"}'
WHERE NOT EXISTS (SELECT 1 FROM cms_site_settings);

-- Homepage content
INSERT INTO cms_content (
    page_type, slug, title, description, content, meta_data, status,
    published_at, version, is_latest, is_listed, nav_order, sort_order
)
SELECT
    'homepage',
    'homepage',
    'GovFleet Namibia',
    'Digital fleet management platform for public and private fleets.',
    JSONB_BUILD_OBJECT(
        'heroTitle', 'Digital Fleet Management for Every Organisation',
        'heroSubtitle', 'Government, Municipalities, Mines, Logistics and Private Fleets',
        'heroDescription', 'GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocation, inspections, fuel records, trip logs, maintenance and trip closure with one secure and traceable digital workflow.',
        'heroCtaLabel', 'Access Dashboard',
        'features', JSONB_BUILD_ARRAY(
            JSONB_BUILD_OBJECT('title', 'Transport Requests', 'description', 'Complete multi-step request wizard with programme activity, route calculation, passengers and driver requirements.', 'icon', 'FileText'),
            JSONB_BUILD_OBJECT('title', 'Approval Workflow', 'description', 'Regional and national approval chains with supervisor review, transport allocation, release and final authorisation.', 'icon', 'Shield'),
            JSONB_BUILD_OBJECT('title', 'Vehicle & Trip Management', 'description', 'Allocation, inspections, driver logsheets, fuel records, defect tracking and trip closure with full audit history.', 'icon', 'Truck'),
            JSONB_BUILD_OBJECT('title', 'Reports & Analytics', 'description', 'Fleet utilisation, fuel consumption, approval turnaround, kilometre variance and comprehensive audit reports.', 'icon', 'BarChart3')
        ),
        'steps', JSONB_BUILD_ARRAY(
            JSONB_BUILD_OBJECT('title', 'Submit Transport Request', 'description', 'The requester creates a transport request with programme activity, route, passengers and driver needs.'),
            JSONB_BUILD_OBJECT('title', 'Supervisor Approves', 'description', 'The immediate supervisor reviews, comments and approves the request. The requester cannot approve their own request.'),
            JSONB_BUILD_OBJECT('title', 'Transport Administrator Allocates', 'description', 'The Transport Administrator validates the route, allocates an exact vehicle and prepares the Trip Authority.'),
            JSONB_BUILD_OBJECT('title', 'Release and Authorise', 'description', 'Administrative release and departure inspection are completed, followed by final authorisation by the designated officer.'),
            JSONB_BUILD_OBJECT('title', 'Driver Operations', 'description', 'The driver acknowledges, receives the vehicle, records daily logs and fuel entries — including offline drafts on a mobile phone.'),
            JSONB_BUILD_OBJECT('title', 'Return and Close', 'description', 'Return inspection, fuel verification, variance calculation and Transport Administrator closure.')
        )
    ),
    '{"title":"GovFleet Namibia","description":"Digital fleet management for every organisation."}',
    'published',
    now(),
    true,
    true,
    10,
    0
WHERE NOT EXISTS (SELECT 1 FROM cms_content WHERE slug = 'homepage');

-- About page
INSERT INTO cms_content (
    page_type, slug, title, description, content, meta_data, status,
    published_at, is_latest, is_listed, nav_order, sort_order
)
SELECT
    'about',
    'about',
    'About GovFleet Namibia',
    'Learn about the fleet management platform and its pilot programme.',
    JSONB_BUILD_OBJECT(
        'mission', 'GovFleet Namibia replaces paper-based transport requests, approvals, vehicle allocations, inspections, fuel records, maintenance and trip closure with one traceable digital platform. We aim to improve accountability, reduce administrative overhead, and provide real-time visibility into fleet operations — for government institutions, regional councils, municipalities, public enterprises, mines, logistics providers, NGOs and private companies alike.',
        'values', JSONB_BUILD_ARRAY(
            JSONB_BUILD_OBJECT('title', 'Accountability', 'description', 'Every action is logged and attributed. Full audit trail from request to trip closure.', 'icon', 'Shield'),
            JSONB_BUILD_OBJECT('title', 'Efficiency', 'description', 'Digital workflows replace paper-based processes, reducing turnaround times significantly.', 'icon', 'Truck'),
            JSONB_BUILD_OBJECT('title', 'Transparency', 'description', 'Real-time visibility into fleet operations, approvals, and resource utilisation across all levels.', 'icon', 'BarChart3')
        ),
        'pilot', 'The Kavango East Regional Council is serving as the pilot tenant for this platform. The pilot validates the digital workflow across all stages of fleet operations, and the platform is built for any organisation that manages vehicles or transport workflows.'
    ),
    '{}',
    'published',
    NOW(),
    true,
    true,
    20,
    0
WHERE NOT EXISTS (SELECT 1 FROM cms_content WHERE slug = 'about');

-- Services page
INSERT INTO cms_content (
    page_type, slug, title, description, content, meta_data, status,
    published_at, is_latest, is_listed, nav_order, sort_order
)
SELECT
    'services',
    'services',
    'Platform Services',
    'End-to-end digital fleet management services.',
    JSONB_BUILD_OBJECT(
        'intro', 'End-to-end digital fleet management for any organisation — government, municipalities, mines, logistics and private fleets.',
        'modules', JSONB_BUILD_ARRAY(
            JSONB_BUILD_OBJECT('title', 'Transport Requests & Approvals', 'description', 'A guided multi-step workflow for submitting, reviewing, and approving transport requests.', 'icon', 'FileText'),
            JSONB_BUILD_OBJECT('title', 'Vehicle Allocation & Trip Management', 'description', 'End-to-end vehicle assignment, pre-trip inspection, trip authorisation, and driver acknowledgment.', 'icon', 'Truck'),
            JSONB_BUILD_OBJECT('title', 'Inspections & Defect Management', 'description', 'Standardised pre-trip and return inspection checklists with automatic defect creation.', 'icon', 'ClipboardCheck'),
            JSONB_BUILD_OBJECT('title', 'Fuel Management & Expenses', 'description', 'Fuel transaction recording with odometer validation, receipt capture, and consumption reports.', 'icon', 'Fuel'),
            JSONB_BUILD_OBJECT('title', 'Fleet Compliance & Maintenance', 'description', 'Vehicle compliance tracking, licence and insurance expiry alerts, and maintenance scheduling.', 'icon', 'Wrench'),
            JSONB_BUILD_OBJECT('title', 'Reports, Analytics & Mobile Access', 'description', 'Comprehensive reporting suite and mobile-optimised driver self-service portal.', 'icon', 'BarChart3')
        )
    ),
    '{}',
    'published',
    NOW(),
    true,
    true,
    30,
    0
WHERE NOT EXISTS (SELECT 1 FROM cms_content WHERE slug = 'services');

-- Default FAQ entries (idempotent by question+category)
INSERT INTO cms_faqs (category, question, answer, sort_order, is_published)
SELECT * FROM (VALUES
    ('general', 'What is GovFleet Namibia?', 'GovFleet Namibia is a digital fleet management platform that replaces paper-based transport requests, approval, vehicle allocation, inspections, fuel records, trip closure and maintenance with one secure, traceable workflow.', 10),
    ('general', 'Who can use the platform?', 'The platform is designed for government institutions, regional councils, municipalities, public enterprises, mines, logistics providers, NGOs and private companies that manage vehicles or transport workflows.', 20),
    ('getting-started', 'How do I request a demonstration?', 'Use the "Request a Demonstration" form on the contact page to reach our team. We will set up a walkthrough tailored to your organisation.', 10)
) AS seed(category, question, answer, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM cms_faqs WHERE category = seed.category AND question = seed.question);
-- Note: the above seeds fixed sort_order 10/20/10; populate is_published separately below.
UPDATE cms_faqs SET is_published = true
WHERE is_published = false AND category IN ('general', 'getting-started');