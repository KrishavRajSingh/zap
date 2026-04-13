# Zap Founder Roadmap

This file is the operating manual for turning Zap from a cool browser-agent project into a company.

Read this once end to end.
After that, look only at the current week and the current checklist.

If you do not know what to do next, do the first unchecked item in the current week.

## Start Here

If you are a beginner founder, read these files in this order.

1. `FOUNDER-ROADMAP.md`
2. `BUYER-CHEAT-SHEET.md`
3. `DISCOVERY-CALL-SCRIPT.md`
4. `THIS-WEEK.md`

Use them like this:

- `FOUNDER-ROADMAP.md` = long-term operating manual
- `BUYER-CHEAT-SHEET.md` = understand the buyer and workflow
- `DISCOVERY-CALL-SCRIPT.md` = what to say on calls
- `THIS-WEEK.md` = what to do right now

## What Success Looks Like

- 1 painful workflow
- 1 buyer type
- 1 wedge
- 3 design partners
- 30+ supervised runs
- 1 paid pilot

If you get those, you have the beginning of a company.

## Beginner Rules

These rules matter because beginners often hide in learning instead of doing.

- read only to unblock action
- do not spend 5 hours reading if 45 minutes would be enough to ask a better question
- every reading session must end in one of these: a note, a change, a message sent, or a better question for a user
- do not start a new feature because a repo on GitHub looked cool
- do not start 3 external OSS repos at once

## Time Split

Use this as the default weekly split.

- 60% Zap product + user conversations
- 20% learning and reading
- 15% external OSS contributions
- 5% job-safety tasks like resume, portfolio notes, and tracking opportunities

If money gets tight, change it to this:

- 50% Zap
- 20% learning
- 20% external OSS
- 10% job search

## Beginner Learning Track

You do need to read, but only the right things.

### What To Learn First

You need working knowledge in 4 areas.

1. Buyer workflow
2. Your own product codebase
3. Browser automation fundamentals
4. Basic startup vocabulary

### Reading Order For The First 2 Weeks

Do these in order.

1. Read `BUYER-CHEAT-SHEET.md` fully
2. Read `DISCOVERY-CALL-SCRIPT.md` fully
3. Re-read `README.md`
4. Read these files in your own codebase:
   - `src/pages/index.tsx`
   - `src/components/agent-console.tsx`
   - `src/background/index.ts`
   - `src/pages/api/agent/plan.ts`
5. Read official docs for one browser-agent-adjacent repo only. Default: `Stagehand`
6. Read official docs for one browser automation system only. Default: `Playwright`

### Terms You Must Understand

Learn these basic business terms early.

- ICP = ideal customer profile
- discovery call = call to learn workflow and pain
- design partner = early user helping shape the product
- pilot = limited real-world test
- CRM = the sheet where you track prospects
- paid pilot = first proof someone will pay
- wedge = narrow market and workflow you are starting with

### Learning Rule

Do not study a topic unless it helps one of these immediately.

- understand the buyer better
- improve Zap for the current workflow
- contribute to the current external OSS repo
- get better at a real discovery call

## External OSS Contribution Lane

Yes, you should contribute outside your own repo, but in a controlled way.

### Why You Are Doing This

External OSS helps with:

- job credibility
- learning from strong codebases
- networking with maintainers and users
- public proof that you can work in real systems

### Why You Are Not Doing Too Much Of It

External OSS is not the main mission right now.

Your main mission is:

- get users
- improve Zap for one workflow
- get to a pilot

### Default External Repo Order

Use this priority order unless a specific issue changes your mind.

1. `browserbase/stagehand`
2. `rivet-dev/sandbox-agent`
3. `triggerdotdev/trigger.dev`

Why this order:

- `Stagehand` is closest to your product and skill set
- `sandbox-agent` is smaller and AI-relevant enough that you can matter faster
- `trigger.dev` has strong job signal, but it is broader and can become a distraction

### OSS Rules

- only one external repo at a time
- maximum `4-6` hours per week on external OSS
- do not chase stars, chase merged work
- prefer bug fixes, tests, docs, examples, and small devex wins
- do not build a huge feature as your first contribution
- comment on an issue before spending days building a fix

### External OSS Weekly Cadence

Use this every week.

- Monday: scan issues for 20-30 minutes
- Tuesday: reproduce one issue locally or read relevant code
- Wednesday: leave one helpful issue comment or question if needed
- Thursday: build a small fix, doc improvement, or repro
- Friday: open PR or park the work if it is not converging

### External OSS Exit Criteria

By the end of Week 6, aim for one of these outcomes.

- 1 merged PR
- 1 accepted issue plan with maintainer feedback
- 1 meaningful docs/example contribution linked to your GitHub

## The Core Strategy

Zap should not compete as:

- a generic browser agent
- an AI-native browser
- a browser SDK
- a browser infra company

Zap should compete as:

- an approval-first browser operator for ugly portal workflows
- running in the user's real browser session
- keeping the human in control for risky actions
- showing full logs and replay for trust

## Default Wedge

Use this unless real user interviews force a change.

- Wedge: vendor onboarding and vendor compliance portal work
- Buyer: operations manager, procurement ops, vendor onboarding manager, AP ops, finance ops
- User: operations coordinators and admins doing repetitive portal work

## Default Geography

Do not think about this as targeting or avoiding people by nationality.

Think about it as targeting companies with:

- higher software budgets
- faster willingness to pay for operations tools
- stronger English-language business workflows
- cleaner early pilot sales cycles

Default first markets:

- Tier 1: United States
- Tier 1: United Kingdom
- Tier 1: Ireland
- Tier 1: Netherlands
- Tier 2: Sweden
- Tier 2: Denmark
- Tier 2: Norway
- Tier 2: Finland

Conditional market, not default:

- Germany only when the target company is clearly English-friendly and outward-facing

Later market, not first pass:

- India only for selective global-facing companies with clear software budgets and English-first teams

Default language rule for the first 12 weeks:

- target English-first buyers only

Markets to avoid in the first GTM pass:

- low-budget markets where pilot pricing will be hard
- companies that need non-English product support immediately
- companies that are extremely price-sensitive by default

Why this matters:

- you are still finding product-market fit
- you do not want pricing feedback distorted by low-budget buyers
- you do not want to localize before the workflow itself works

Evidence behind this choice:

- World Bank 2024 GDP per capita is much higher in your preferred first markets than in India. Examples: United States about `84.5k`, Ireland about `112.9k`, Netherlands about `67.5k`, Denmark about `71.0k`, Sweden about `57.1k`, Germany about `56.1k`, United Kingdom about `53.2k`, India about `2.7k`.
- Eurostat reports strong enterprise digital adoption in the specific European countries you want to prioritize. In 2025, enterprise use of paid cloud services was especially high in Finland `79.21%`, Ireland `73.04%`, and Sweden `72%`. High dependence on cloud was also high in Denmark `64.98%` and the Netherlands `62%`.
- EF English Proficiency Index 2025 shows very strong English environments in the Netherlands `#1`, Germany `#4`, Norway `#5`, Denmark `#7`, and Sweden `#8`. India ranks `#74` overall, and its `Purchasing & Procurement` function scores lower than its tech and metro pockets.

What this means in practice:

- your instinct to focus on higher-budget US and European buyers is directionally right
- your old rule was still too broad because `Europe` is not one market
- your first pass should prefer US, UK/Ireland, Netherlands, and Nordics before broad Germany or broad India

## Default First Workflow

This is the workflow Zap should own first.

1. Read vendor docs from email or local files
2. Open the vendor or supplier portal
3. Fill company profile fields
4. Upload required docs
5. Flag missing fields or missing files
6. Pause before final submit

This is a strong first workflow because:

- it is browser-heavy
- it uses real logged-in sessions
- it is repetitive
- mistakes matter
- approval is normal
- your current product already fits this shape

## What Not To Do

Do not do these things in the first 12 weeks.

- Do not build your own browser
- Do not market Zap as "AI that can do anything on the web"
- Do not target 3 industries at once
- Do not optimize for GitHub stars
- Do not spend time fundraising before paid pilot signal
- Do not build a large no-code agent builder
- Do not add voice as the main story
- Do not add broad integrations just because competitors have them
- Do not take fake discovery feedback seriously
- Do not optimize your first GTM pass for low-budget markets

## Current Product Audit

This section is based on the current repo.

### What Already Exists

From `README.md`:

- sidepanel agent console
- popup launcher
- background automation loop
- approval gate for sensitive clicks
- auth
- planner APIs
- run logs and planner traces

This is enough to start discovery, demos, and supervised pilots.

### What Is Currently Wrong

The product is stronger than the positioning.

The current site still sounds like a generic browser agent.

Problems in the current marketing/product framing:

- `src/pages/index.tsx`: broad hero copy
- `src/pages/index.tsx`: generic demo example `find startups hiring now`
- `src/components/agent-console.tsx`: generic command placeholder `open github and create repo named zap`
- `src/components/agent-console.tsx`: no explicit safe-mode toggle for pilots
- `src/components/agent-console.tsx`: no exportable run summary aimed at buyers
- `src/background/index.ts`: there is approval logic, but no explicit pilot-wide "never submit" mode
- `src/lib/server/openrouter.ts`: planner prompt is broad, not wedge-aware
- there is no terms page for pilot/customer trust

## Exact Product Changes To Make

Do these in order.

### 1. Reposition the Website

File: `src/pages/index.tsx`

Current issue:

- The page sells "browser automation from plain-language commands"
- That is too broad and too weak

Change the page to sell one workflow.

Replace the hero with this direction:

- Eyebrow: `Approval-First Portal Operator`
- Headline: `Clear Vendor Portals Faster`
- Subhead: `Zap helps ops teams fill vendor and supplier portals inside the browser they already use, then pauses before anything sensitive is submitted.`
- CTA 1: `Book a Workflow Teardown`
- CTA 2: `Watch a Real Run`

Replace the current run preview command with a real wedge command:

- `Command: open the supplier portal, finish the vendor profile draft, upload the W-9, and stop before final submit`

Replace the current "What Zap does" cards with these:

- Reads vendor profile tasks from real docs and pages
- Fills repetitive portal fields in the current browser session
- Pauses before final submit or other risky actions
- Shows exactly what it did and where it got stuck

Add a new section called `Best For` with these bullets:

- supplier onboarding portals
- vendor compliance updates
- repetitive browser-based profile entry
- teams that need humans to approve final actions

Add a new section called `Not For` with these bullets:

- personal browsing
- banking automation
- fully autonomous high-risk workflows
- broad consumer assistant use cases

Add a section called `Why Teams Trust It`:

- works in the real browser session they already use
- no need to hand over passwords
- approval before risky actions
- live execution log and trace

Acceptance criteria:

- a buyer can tell in 5 seconds who this is for
- there is no broad "do anything" language left on the page
- demo example matches the wedge

### 2. Add Pilot Safe Mode to the UI

File: `src/components/agent-console.tsx`

Current issue:

- There is a stop button and approval flow
- There is no obvious pilot-safe mode the customer can trust immediately

Add a visible toggle directly under the command input:

- Label: `Pilot Safe Mode`
- Description: `Fill and prepare only. Never submit final actions.`
- Default: `on`

Also add a second toggle:

- Label: `Approval Required For Sensitive Actions`
- Default: `on`
- This should remain on in all early pilots

Change the command placeholder from:

- `Example: open github and create repo named zap`

to:

- `Example: open the supplier portal, fill the vendor profile, upload the insurance certificate, and stop before final submit`

Rename the `Saved Answers` section to something more buyer-legible:

- New label: `Company Data`
- Description: `Reusable answers Zap can use for repetitive form fields`

Add a `Copy Run Summary` button in the execution log area.

The summary should include:

- command
- site URL
- run status
- steps executed
- approval requested or not
- where it failed or stopped

Acceptance criteria:

- a buyer can see safe mode at a glance
- a user can export a summary after every pilot run
- the UI reads like an operations tool, not a hobby demo

### 3. Extend Runtime Messages for Workflow Mode

File: `src/lib/agent/messages.ts`

Current issue:

- `AgentStartMessage` only contains `command`

Add these fields to `AgentStartMessage`:

- `workflowProfile: string | null`
- `pilotSafeMode: boolean`
- `allowFinalSubmit: boolean`

Use these values end to end so the planner and background loop know they are running a wedge-specific safe pilot.

Acceptance criteria:

- a run can be started in a specific workflow mode
- safe mode travels from UI to runtime

### 4. Add Workflow and Outcome Types

File: `src/lib/agent/types.ts`

Add types for:

- `WorkflowProfile`
- `RunOutcomeCategory`
- `RunFailureReason`
- `RunSummary`

Recommended first values:

- `WorkflowProfile`: `vendor_onboarding`
- `RunOutcomeCategory`: `success`, `partial_success`, `blocked`, `stopped`, `unsafe_prevented`, `failed`
- `RunFailureReason`: `missing_login`, `missing_file`, `missing_required_field`, `planner_loop`, `selector_resolution_failed`, `upload_blocked`, `approval_rejected`, `site_changed`, `unknown`

Acceptance criteria:

- every run can end in a category
- every failure can be bucketed into one reason

### 5. Make the Planner Wedge-Aware

Files:

- `src/pages/api/agent/plan.ts`
- `src/lib/server/openrouter.ts`

Current issue:

- the planner prompt is broad and generic
- it does not know the run is a safe vendor-onboarding workflow

Add support in the planner request body for:

- `workflowProfile`
- `pilotSafeMode`
- `allowFinalSubmit`

Then change `SYSTEM_PROMPT` in `src/lib/server/openrouter.ts` so it has additional workflow rules when `workflowProfile === "vendor_onboarding"`.

Add rules like:

- prefer company/legal/vendor profile fields over unrelated navigation
- do not submit while visible required fields or required files are unresolved
- in pilot safe mode, never choose final submit even if the page appears complete
- prefer missing-field detection and explicit blockers over guessing
- if a file upload is required and not available, stop and explain exactly what file is missing
- if the user is logged out or the session is expired, stop and explain that login is needed

Acceptance criteria:

- planner avoids broad browsing and stays inside the workflow
- planner never final-submits in pilot safe mode
- planner explains blockers clearly

### 6. Add Hard Submit Blocking in the Background Loop

File: `src/background/index.ts`

Current issue:

- there is sensitive action confirmation
- there is some submit blocking around missing required fields
- there is no strong global pilot-mode rule that says final submit is not allowed

Add runtime logic:

- if `pilotSafeMode === true` and an action is a final submit/save/complete/publish/send action, do not execute it
- instead finish with `success=false` and a message like `Pilot safe mode stopped before final submit.`

Also add run-level classification:

- classify end state into `RunOutcomeCategory`
- classify failure into `RunFailureReason`

Add a `run summary` object at the end of each run.

Include:

- run id
- workflow profile
- pilot safe mode
- site URL
- outcome category
- failure reason if any
- steps attempted
- approvals requested
- approvals accepted
- elapsed time

Acceptance criteria:

- pilot runs can never accidentally final submit
- each run ends with a structured summary

### 7. Improve Pilot Trust Surfaces

Files:

- `src/components/agent-console.tsx`
- `src/pages/privacy.tsx`
- create `src/pages/terms.tsx`

Changes:

- show current signed-in user in the console more clearly
- show current active site and run status clearly
- add a simple `Terms` page linked from the site header
- update privacy page language to mention pilot behavior and run logging in plain English

Minimum terms topics:

- pilot usage only
- user remains responsible for final approval
- no warranty for early pilot behavior
- customer should not use Zap for prohibited or regulated high-risk tasks without approval

Acceptance criteria:

- a buyer sees basic business seriousness
- site has both privacy and terms

## Company Operating Setup

These are the minimum systems you need before trying to build a company.

### Your Basic Stack

Set up these things in Week 0.

- company domain
- founder email on that domain
- one calendar booking link
- one CRM spreadsheet
- one pilot-notes folder
- one Loom account or equivalent screen recorder
- one invoice template
- one pilot agreement draft

### Weekly Founder Schedule

Use this schedule until you have paying customers.

- Monday morning: research accounts and send outreach
- Monday afternoon: product fixes from the last real user feedback
- Tuesday: discovery calls and follow-ups
- Wednesday morning: product work only on workflow-specific reliability issues
- Wednesday afternoon: learning block tied to your current workflow or OSS repo
- Thursday: live walkthroughs, demos, and supervised pilot runs
- Friday morning: metrics review, proposal writing, and follow-ups
- Friday afternoon: external OSS block or issue review
- Saturday: optional deep work block for docs, OSS, or code cleanup
- Sunday: review, rest, and next-week plan

Simple rule:

- at least half your work time should touch prospects, customers, or proof

### Daily Minimums

If you are working on Zap full-time, use these minimums.

- 5 new accounts researched
- 3 new outreach messages sent
- 1 follow-up sent
- 1 user conversation, demo, or pilot run
- 1 product improvement tied to a real workflow

Also keep these weekly minimums:

- 3 learning sessions of 30-45 minutes
- 1 external OSS session
- 1 mock or real discovery conversation practice

### CRM Spreadsheet Columns

Create a spreadsheet called `Zap CRM` with these columns.

- Company
- Website
- Industry
- Segment
- Why they fit
- Portal-heavy workflow seen?
- Contact name
- Contact title
- Contact profile URL
- Email
- Contact source
- Date first contacted
- Status
- Last touch
- Next action
- Call booked?
- Workflow pain notes
- Pilot fit score 1-5
- Design partner?
- Paid pilot?

### Call Notes Template

For every discovery call or walkthrough, copy this exact structure.

- Company:
- Contact:
- Title:
- Date:
- Workflow discussed:
- Portals involved:
- Documents involved:
- What gets re-entered:
- What part is slow:
- What part causes mistakes:
- What requires approval:
- How often this happens:
- Estimated manual time:
- Would they test a supervised pilot:
- Next action:

### Your Status Values

Use these exact status values so the sheet stays clean.

- `not_researched`
- `researched`
- `contacted`
- `replied`
- `call_booked`
- `call_done`
- `pilot_candidate`
- `design_partner`
- `paid_pilot`
- `lost`

## How To Find Leads

This section matters as much as product work.

Do not wait for inbound.

### Geography Filter

For the first 100 accounts, use this default geography split.

- 60 United States
- 20 United Kingdom and Ireland
- 10 Netherlands
- 10 Nordics

Do not use Germany as a default first-100 market.

Germany is allowed only if:

- the company site is already English-friendly
- the buyer works in an international or cross-border role
- the workflow clearly fits without localization work

India is not part of the first 100 by default.

India becomes valid later only if:

- the company already buys global software
- the team is English-first
- the buyer has real budget authority
- the workflow is painful enough to justify pilot pricing

Keep the first pass English-first even inside Europe.

That means:

- English websites
- English job titles
- English outreach
- no custom localization work yet

### Ideal First Company Types

Target companies where:

- they have many vendors
- they log into portals regularly
- forms and document uploads are common
- operations teams are small and stretched
- mistakes matter but a human approval step is acceptable

Best first company categories:

- property management groups
- construction firms
- staffing companies
- hospitality groups
- healthcare operations groups with many suppliers
- manufacturing companies with supplier onboarding overhead

### Titles To Search

Search for these exact titles.

- vendor onboarding manager
- supplier onboarding manager
- procurement operations manager
- procurement specialist
- accounts payable operations manager
- finance operations manager
- operations manager
- vendor compliance manager
- supplier compliance analyst

### Exact Search Queries

Use these exact searches on Google.

- `site:linkedin.com/in "vendor onboarding manager"`
- `site:linkedin.com/in "supplier onboarding manager"`
- `site:linkedin.com/in "vendor compliance manager"`
- `site:linkedin.com/in "procurement operations manager"`
- `site:linkedin.com/in "accounts payable operations manager" vendor`
- `"become a vendor" company`
- `"supplier registration" company`
- `"vendor portal" company`
- `"supplier onboarding" company`
- `"vendor compliance" company`
- `"vendor onboarding specialist" jobs`
- `"supplier onboarding specialist" jobs`

Add geography filters like these:

- `site:linkedin.com/in "vendor onboarding manager" "United States"`
- `site:linkedin.com/in "procurement operations manager" "United Kingdom"`
- `site:linkedin.com/in "supplier onboarding manager" Netherlands`
- `site:linkedin.com/in "operations manager" Ireland procurement`
- `"supplier registration" company "United States"`
- `"vendor portal" company "United Kingdom"`
- `"become a vendor" company Netherlands`
- `"vendor compliance" company Sweden`
- `"vendor onboarding" company Denmark`
- `"supplier portal" company Finland`

Also use company-finding searches like these:

- `site:linkedin.com/company "property management" vendor portal`
- `site:linkedin.com/company construction supplier onboarding`
- `site:linkedin.com/company staffing vendor compliance`
- `site:linkedin.com/company hospitality supplier portal`

### How To Build the First 100 Accounts

Do this exactly.

1. Search Google for one of the company-type terms, for example `property management vendor compliance`.
2. Open 20 company sites.
3. Keep only companies that clearly work with many suppliers or vendors.
4. Check if their site references `vendor`, `supplier`, `registration`, `compliance`, or `portal`.
5. Search the company on LinkedIn.
6. Find one operations or procurement person.
7. Check the company geography and keep only your target markets.
8. Add them to the CRM.

Keep the first 100 accounts in this mix:

- 30 property management
- 25 construction
- 20 staffing
- 15 hospitality
- 10 healthcare operations

Add this geography split on top of the industry mix:

- 60 United States
- 20 United Kingdom and Ireland
- 10 Netherlands
- 10 Nordics

### Lead Quality Rules

Good lead signs:

- mid-sized company
- based in the United States or higher-budget Europe
- English-language website and team pages
- in Europe, especially strong fit for UK, Ireland, Netherlands, Sweden, Denmark, Norway, and Finland
- has operations people
- has multiple locations
- has many external vendors or suppliers
- has a vendor or supplier page on the website
- hiring for procurement, AP, vendor onboarding, or compliance roles
- likely to have software budget and operational pain worth paying to solve

Bad lead signs:

- solo operator
- tiny team with no ops staff
- giant enterprise where you cannot get a workflow easily
- pure software startup with little vendor complexity
- obvious low-budget outsourcing play where pricing will dominate every conversation
- requires non-English product support before any pilot value has been proven
- Germany account with a German-only buyer journey unless the opportunity is unusually strong
- India account without clear global budget and buying authority

### Outreach Timing

Send outreach when buyers are likely to see it during working hours.

Use this simple rule:

- US prospects: send in their morning
- UK and Ireland: send in their morning
- Europe: send in their morning or early afternoon

Do not batch-send at random hours just because it is convenient for you.

## What To Say

Use this message first.

```text
Hi [Name], I’m learning how teams handle repetitive vendor portal work like company profile setup, document uploads, missing-field checks, and approval before final submission.

I’m building a browser-based assistant that works in the user’s real browser and helps with this workflow while keeping humans in control for anything sensitive.

I’m not hard-selling anything yet. I’m trying to understand how teams actually do this work today. Would you be open to a 15-minute chat?
```

If they reply positively, send this:

```text
The most helpful thing would be seeing one real workflow from start to finish.

For example: vendor docs arrive -> someone logs into a portal -> they fill fields -> upload files -> check missing items -> stop before final submit.

I mainly want to see where the repetitive work and mistakes happen.
```

### Follow-Up Message

If they do not reply after 4 days:

```text
Following up because this seems like the sort of workflow where a lot of time gets lost to repetitive portal work.

If this is not your area, is there someone on ops, procurement, vendor onboarding, or AP that owns it?
```

## Discovery Calls

The goal of discovery is not to pitch.

The goal is to learn the workflow and get a pilot.

### Call Structure

Use this structure.

1. 2 minutes: explain why you are talking to them
2. 10 minutes: let them explain the workflow
3. 10 minutes: ask about pain, mistakes, approvals, and repetition
4. 5 minutes: ask for a live walkthrough or pilot if the fit is real

### Exact Questions

Ask these questions in order.

1. What is the most repetitive portal work your team does every week?
2. Which sites or portals do people log into most often?
3. Walk me through the last time someone did this workflow.
4. Where do people re-enter the same information more than once?
5. Which files or documents are usually involved?
6. What part is the slowest?
7. What part causes mistakes?
8. What would you never automate without approval?
9. If this worked safely, who would approve trying it?
10. Would you be open to a supervised pilot where your team stays in control?

### Best Discovery Question

Ask this whenever possible:

- `Can you show me the last time this was annoying?`

That question is better than abstract opinions.

### What A Good Discovery Call Sounds Like

Good signs:

- they name the exact portal
- they name the exact files involved
- they complain about repetitive entry or missing-field checks
- they say the task happens weekly or daily
- they immediately understand why approval matters

Bad signs:

- they only speak in vague generalities
- the task happens rarely
- the workflow already has a strong API-based solution
- they say the demo is cool but do not care enough to test it

## Live Workflow Walkthroughs

This is where real insight happens.

### Rules

- Do not ask for passwords
- Let them log in themselves
- Let them keep control
- Record notes, not secrets
- Ask them to narrate each step

### What To Write Down

For every walkthrough, capture:

- portal name
- login friction
- number of fields
- number of uploads
- where copy-paste happens
- approval step
- common blockers
- manual time estimate
- whether the user thinks this is painful enough to fix

### What To Ask For At The End

If the walkthrough is strong, ask this directly.

```text
This looks like a strong fit for what I’m building. Would you be open to a supervised pilot where you log in yourself, stay in control, and we test this in fill-but-don’t-submit mode?
```

## Pilot Design

Early pilots should be safe by default.

### Stage 1

- Zap reads and suggests
- no final form submission
- user reviews all extracted values

### Stage 2

- Zap fills the real portal
- user reviews everything
- user decides whether to submit manually

### Stage 3

- Zap can take more actions only after repeated successful runs
- approval stays on for any sensitive action

### Pilot Promise

Do not promise autonomy.

Promise this instead:

- reduce repetitive data entry
- prepare work faster
- stop before risky actions
- surface blockers clearly

### Pilot Ground Rules

Use these rules with every early customer.

- the user logs in themselves
- Zap runs in pilot safe mode by default
- no final submit unless explicitly approved and only after repeated safe runs
- all runs are logged
- if Zap is unsure, it stops and asks
- if the workflow changes, fix the product before expanding scope

### Pilot Agreement Outline

Your first pilot agreement can be simple, but it should include these sections.

- parties
- workflow in scope
- pilot duration
- pilot fee
- support expectations
- customer responsibilities
- confidentiality wording
- early-product no-warranty wording
- limitation of liability
- payment terms
- termination rights

Do not let the first pilot become open-ended consulting.

Keep the scope tight.

Example scope line:

- `Pilot covers one vendor-onboarding workflow in pilot safe mode for one customer team and one set of portals agreed in writing.`

### Pilot Success Metrics

Track these every run.

- manual time
- assisted time
- run outcome category
- failure reason
- number of approvals requested
- number of human corrections
- whether the user would use it again

Good early success looks like:

- 30% to 50% time saved
- no unsafe submits
- high trust
- repeated demand for more workflows

### Proof Asset Checklist

Once you have enough runs, create one proof pack with these items.

- 2-minute screen recording of a real run
- one benchmark sheet with manual time vs assisted time
- one table of run outcomes and failure reasons
- one screenshot of the approval gate in action
- one short customer quote or testimonial
- one short write-up: workflow, result, limits, next step

## Pricing and Paid Pilots

You do not need fancy pricing yet.

### First Pricing Rule

Charge for the pilot once a design partner clearly sees value.

### Pilot Offer Shape

Use something like this:

- fixed-duration pilot
- one workflow only
- supervised rollout
- weekly support and fixes
- proof report at the end

### Pilot Proposal Structure

Your pilot proposal should fit on one page.

Include:

- customer name
- workflow in scope
- what Zap will do
- what Zap will not do
- safety model
- duration
- success metrics
- support included
- price
- start date
- decision needed from the customer

### Invoice Template Fields

Your invoice should always contain these fields.

- your company name
- your address
- invoice number
- invoice date
- customer name
- customer billing contact
- description of pilot
- amount due
- payment due date
- payment instructions

Do not price based on tokens.

Price based on:

- support
- implementation time
- workflow value
- buyer seriousness

## Company Setup From Scratch

Do not do all of this on day one.

Do it in this order.

### Before Any Revenue

- buy domain
- create founder email
- create privacy page
- create terms page
- prepare invoice template
- prepare pilot agreement draft

### Before First Paid Pilot

- create legal company entity in your country
- open business bank account
- keep company money separate from personal money
- set up simple bookkeeping
- use company email for all pilot contracts

### Simple Bookkeeping Rule

Track only these things at first.

- cash in
- cash out
- software subscriptions
- contractor spend if any
- tax-related documents

Do not let admin work consume your best building hours.

### What You Do Not Need Yet

- a full legal team
- a cap table tool
- a fancy deck
- an LLC in a trendy jurisdiction just because Twitter said so
- payroll
- employees

## Weekly Execution Plan

This section is the main checklist.

### Week 0: Foundation

Goal: set up your operating system before talking to users.

- [ ] Create the CRM spreadsheet with the columns listed above
- [ ] Buy the domain you want to use
- [ ] Create a founder email on the domain
- [ ] Create a calendar booking link
- [ ] Create a folder structure: `calls`, `pilots`, `demos`, `proof`
- [ ] Create a one-line company description
- [ ] Create a short Loom intro of current Zap
- [ ] Read this roadmap fully and commit to one wedge for 6 weeks
- [ ] Commit to one geography filter for the first 100 accounts: US + UK/Ireland + Netherlands + Nordics

Learning:

- [ ] Read `BUYER-CHEAT-SHEET.md`
- [ ] Read `DISCOVERY-CALL-SCRIPT.md`
- [ ] Write your own one-paragraph summary of the buyer workflow
- [ ] Learn the meaning of these terms: ICP, discovery call, design partner, pilot, CRM, paid pilot

External OSS:

- [ ] Pick one external repo only. Default: `browserbase/stagehand`
- [ ] Star/watch the repo and read its README or docs overview
- [ ] Create a note with 3 possible issue areas you understand even partially

Deliverables by end of week:

- working calendar link
- working domain email
- empty CRM ready to fill
- one short demo video
- one written summary of the buyer workflow in your own words
- one chosen external OSS repo

### Week 1: Fix the Story

Goal: make the product understandable to buyers.

Product:

- [ ] Update `src/pages/index.tsx` hero copy to the wedge-specific story
- [ ] Replace generic demo example with the vendor-onboarding workflow
- [ ] Add `Best For` and `Not For` sections to the page
- [ ] Update `src/components/agent-console.tsx` command placeholder
- [ ] Rename `Saved Answers` to `Company Data`

Learning:

- [ ] Re-read `README.md`
- [ ] Read these code files carefully:
  - `src/pages/index.tsx`
  - `src/components/agent-console.tsx`
  - `src/background/index.ts`
- [ ] Practice the discovery-call opener 3 times out loud

GTM:

- [ ] Add first 25 target companies to the CRM from the target geographies only
- [ ] Send first 10 outreach messages
- [ ] Aim to book 2 calls

External OSS:

- [ ] Spend no more than 2 hours reading the selected external repo code/docs
- [ ] Choose 1 issue or doc gap to understand better
- [ ] If appropriate, leave 1 concise issue comment or question

Exit criteria:

- site no longer sounds generic
- 25 accounts in CRM
- 10 messages sent

### Week 2: Make the Product Safe for Pilots

Goal: ship trust surfaces.

Product:

- [ ] Add `pilotSafeMode` and `allowFinalSubmit` fields to `src/lib/agent/messages.ts`
- [ ] Add workflow and run outcome types to `src/lib/agent/types.ts`
- [ ] Add visible `Pilot Safe Mode` toggle to `src/components/agent-console.tsx`
- [ ] Add `Copy Run Summary` button to `src/components/agent-console.tsx`
- [ ] Add strong final-submit blocking logic in `src/background/index.ts`

GTM:

- [ ] Add another 25 accounts to CRM
- [ ] Send 10 more outreach messages
- [ ] Run 2 discovery calls

Learning:

- [ ] After each call, rewrite the workflow in your own words
- [ ] Make a list of every portal/document term the buyer used that you did not understand
- [ ] Learn only those missing terms

External OSS:

- [ ] Reproduce one small issue or identify one docs/example improvement in your selected repo
- [ ] If it is simple enough, start the first small contribution

Exit criteria:

- safe mode exists in UI
- final submit can be blocked globally
- at least 2 calls completed

### Week 3: Make the Planner Workflow-Aware

Goal: keep Zap inside the chosen job instead of general browsing.

Product:

- [ ] Extend `src/pages/api/agent/plan.ts` to accept workflow context
- [ ] Update `src/lib/server/openrouter.ts` prompt for vendor-onboarding mode
- [ ] Add clear failure reasons and outcome categories in `src/background/index.ts`
- [ ] Return structured run summaries at the end of runs

GTM:

- [ ] Run 3 more discovery calls
- [ ] Ask at least 2 prospects for a live walkthrough

Exit criteria:

- planner behaves more like a workflow assistant than a generic agent
- 5 total calls completed

### Week 4: Watch Real Work

Goal: stop guessing.

Product:

- [ ] Fix the top 3 obvious issues discovered from the first calls
- [ ] Improve file upload blocker messages
- [ ] Improve login-expired blocker messages

GTM:

- [ ] Watch 2 live workflow walkthroughs
- [ ] Capture exact portal steps and documents used
- [ ] Ask for 1 supervised pilot partner

Exit criteria:

- 2 live walkthroughs completed
- 1 real pilot candidate identified

### Week 5: Start the First Supervised Pilot

Goal: run the workflow on real pages in safe mode.

Product:

- [ ] Add run summary fields needed for proof
- [ ] Make errors more human-readable in the console
- [ ] Improve stop behavior and recovery after interruption

Pilot:

- [ ] Run 5 supervised pilot executions
- [ ] Log manual time vs assisted time
- [ ] Log every failure reason
- [ ] Do not expand scope yet

Exit criteria:

- 5 real supervised runs completed
- failure log exists

### Week 6: Reliability Week

Goal: fix repeated failures only.

Product:

- [ ] Review all week-5 failures
- [ ] Fix the top 5 repeated issues only
- [ ] Add site-specific memory for the repeated target portal if needed

Pilot:

- [ ] Run 10 more supervised executions
- [ ] Track whether trust is rising or falling

Exit criteria:

- 15 total supervised runs
- top repeated failures reduced

### Week 7: Add Business Basics

Goal: look minimally credible to a customer.

Product and site:

- [ ] Create `src/pages/terms.tsx`
- [ ] Link `Terms` from the main site
- [ ] Update `src/pages/privacy.tsx` for pilot wording

Company:

- [ ] Create invoice template
- [ ] Create simple pilot agreement draft
- [ ] Create one-page pilot proposal template

GTM:

- [ ] Send 15 more outreach messages using pilot learnings

Exit criteria:

- privacy and terms pages exist
- invoice and pilot docs exist

### Week 8: Get a Design Partner

Goal: secure one real partner, not just one curious call.

Product:

- [ ] Improve setup instructions for pilot-safe runs
- [ ] Improve run summary export

GTM:

- [ ] Ask 3 strongest prospects directly for a design-partner pilot
- [ ] Book 3 more calls if pipeline is weak
- [ ] Get 1 active design partner

Exit criteria:

- 1 design partner confirmed

### Week 9: Run 15 More Real Executions

Goal: build proof, not features.

Product:

- [ ] Fix only issues that blocked real runs
- [ ] Do not add net-new horizontal features

Pilot:

- [ ] Complete 15 more supervised executions
- [ ] Update benchmark sheet after each run

Exit criteria:

- 30 total supervised executions reached

### Week 10: Turn Results Into a Proof Asset

Goal: convert reliability into something sellable.

- [ ] Record one 2-minute real workflow demo
- [ ] Create one benchmark sheet with time saved and outcomes
- [ ] Write one short case-study page
- [ ] Ask the design partner for a testimonial if results are real

Exit criteria:

- proof asset exists
- demo exists

### Week 11: Ask for the Paid Pilot

Goal: find out if this is a business.

- [ ] Send the paid pilot proposal to the design partner
- [ ] Ask for a fixed-scope paid pilot
- [ ] Keep outreach going to a second wave of 30 accounts

Exit criteria:

- at least one paid-pilot ask made

### Week 12: Decide Honestly

Goal: choose the next move based on truth.

If the signals are good:

- [ ] double down on the same workflow
- [ ] get a second paid pilot

If the signals are mixed:

- [ ] keep the wedge, change the workflow

If the signals are bad:

- [ ] change the wedge quickly

Use these decision rules:

- if users say "this is cool" but do not make time for pilots, the pain is weak
- if users love it but do not trust the automation, keep the wedge and improve reliability
- if users trust it and ask for more, charge

## Weekly Review Template

Every Friday, answer these questions.

1. How many outreach messages did I send?
2. How many calls did I book?
3. How many calls did I complete?
4. How many live workflows did I watch?
5. How many supervised runs did I complete?
6. What were the top 3 failure reasons?
7. Did trust go up or down this week?
8. What did a user explicitly ask for?
9. What feature did I build without user evidence?
10. What is the single most important thing next week?

## If You Get Distracted

When you feel like building random cool features, read this.

Your job right now is not:

- to win Twitter
- to look like YC
- to be the most technically impressive

Your job right now is:

- to find painful work
- to make Zap reliable for that work
- to prove someone will pay

## Immediate Next Actions

Do these first.

- [ ] Open `THIS-WEEK.md`
- [ ] Create the CRM spreadsheet today
- [ ] Create the domain email today
- [ ] Write the Week 1 landing-page copy draft today
- [ ] Add the first 10 companies today from the US, UK/Ireland, Netherlands, and Nordics only
- [ ] Send the first 5 messages today
