# Buyer Cheat Sheet

This file explains the buyer and workflow in plain English.

Read this before discovery calls.

If you do not understand what the buyer actually does, you will sound vague.
If you understand their job, you can ask much better questions.

## The Buyer In One Sentence

A `Vendor Onboarding Manager` or `Vendor Compliance Manager` helps a company safely add new vendors into its systems so the company can work with them and pay them.

Simple version:

- your company wants to work with a vendor
- someone has to collect the right info and documents
- someone has to enter them into portals or systems
- someone has to make sure nothing risky or incomplete gets approved

That someone is often the kind of buyer you are talking to.

## What A Vendor Is

A `vendor` is just a company or person that supplies something.

Examples:

- electrician
- maintenance contractor
- cleaning company
- staffing agency
- food supplier
- medical supplier
- software vendor

## What Vendor Onboarding Means

Vendor onboarding means:

- collecting vendor details
- collecting required documents
- entering the data into systems or portals
- checking that documents are valid
- getting approval
- making the vendor active in the system

Without this, the company usually cannot:

- pay the vendor
- use the vendor
- let the vendor work on-site
- stay compliant with internal rules

## What Vendor Compliance Means

Vendor compliance means making sure the vendor meets the company’s rules.

Examples:

- tax forms are present
- insurance is valid
- bank details are correct
- licenses are current
- required policies are signed
- approvals are completed

## What This Person Actually Does All Day

Typical daily work:

- receiving emails from internal teams asking to add a vendor
- collecting missing documents from vendors
- opening vendor portals or internal systems
- copying vendor data into forms
- uploading PDFs and certificates
- checking for missing or expired documents
- sending emails back if something is missing
- following approval steps
- updating the record when something changes

It is usually repetitive and detail-heavy.

## Why This Work Is Painful

This work is painful because:

- the same company data gets typed again and again
- files must go in the correct place
- portals are slow and annoying
- different vendors send files in different formats
- things are often incomplete
- one wrong field can create payment or compliance problems
- people have to stop and ask for approval

## What Systems They Usually Use

Common systems:

- email
- spreadsheets
- shared drives
- AP system
- ERP system
- vendor portal
- procurement system
- property management system
- ticketing system

You do not need to name exact tools unless the buyer mentions them.

## Common Documents They Handle

These words will come up a lot.

### W-9

US tax form used to collect vendor tax info.

What the buyer cares about:

- is it present
- is it signed if needed
- does legal name match the vendor record

### ACH Form

Banking form used to set up electronic payments.

What the buyer cares about:

- bank details are complete
- backup docs are attached if required
- it is safe and correct

### Insurance Certificate / COI

Proof that the vendor has insurance.

What the buyer cares about:

- not expired
- correct coverage
- correct named entity if relevant

### Business License

Proof the vendor is licensed to operate where needed.

What the buyer cares about:

- valid
- current
- matches vendor type and location

### Vendor Profile / Supplier Profile

The form or portal page containing the vendor’s basic company data.

What the buyer cares about:

- legal name
- DBA if relevant
- address
- contact info
- tax ID
- bank setup status
- category / type

### Signatory / Authorization Form

Document proving who can approve or act on behalf of the vendor or company.

### Due Diligence Questionnaire

Form asking about policies, ownership, security, or compliance.

## The Workflow Step By Step

This is the workflow you should picture in your head during calls.

1. Someone inside the company says: `we need to add this vendor`
2. Buyer or ops person requests required documents
3. Vendor sends files by email or upload
4. Buyer reviews what is present and what is missing
5. Buyer logs into a portal or system
6. Buyer fills company details
7. Buyer uploads files
8. Buyer checks missing fields or warnings
9. Buyer stops if something is missing or risky
10. Buyer gets approval or sends it back for fixes
11. Vendor becomes active

That is why a browser-based assistant can fit.

## Where Repetitive Work Happens

This is where your product could help.

- copying legal name, address, tax ID, contact details
- moving between email and portal
- matching files to upload slots
- checking which required docs are still missing
- drafting emails asking for missing info
- opening the same pages repeatedly
- handling the same form structure many times

## What They Care About Most

A buyer like this usually cares about:

- speed
- accuracy
- no missing documents
- no wrong uploads
- no bad submissions
- no compliance mess
- no payment setup errors
- auditability
- human approval before risky actions

They do not mainly care about:

- cool AI demos
- autonomy for its own sake
- GitHub stars
- fancy agent architecture

## What Scares Them

This is extremely important.

They are scared of:

- wrong bank details
- expired insurance being accepted
- incomplete vendor setup being submitted
- duplicate vendors
- wrong file in the wrong place
- a tool making silent mistakes
- not knowing what the software did

That is why your answer cannot be:

- `the models are smart enough`

That answer sounds weak and careless.

## What A Good Product Sounds Like To Them

Good language:

- works in the browser they already use
- prepares the work faster
- fills repetitive fields
- helps match documents correctly
- flags what looks missing or wrong
- stops before final submit
- keeps the human in control
- shows what happened

Bad language:

- fully autonomous agent
- AI does everything
- models are smart enough
- replaces your team
- just trust the AI

## How To Talk About Zap

Do not describe Zap as a generic browser tool.

Describe it like this:

- `Zap helps with repetitive portal work in the browser the team already uses.`
- `It can fill fields, handle document-related steps, and stop before final submit so the user stays in control.`

## What To Say When They Ask Hard Questions

### If they ask: `What happens if something is missing?`

Bad answer:

- `the model will figure it out`

Better answer:

```text
If something is clearly missing, the product should stop, explain what looks missing, and help prepare the next step, like drafting a follow-up email or leaving the form in a review state instead of submitting it.
```

### If they ask: `What if it is wrong?`

Better answer:

```text
That’s exactly why I’m focused on approval-first workflow design. The goal is not blind automation. The goal is to reduce repetitive work, surface possible issues, and keep the human in control before anything risky is finalized.
```

### If they ask: `Do we need to switch tools?`

Better answer:

```text
No, the idea is to work inside the browser and systems your team already uses, not force a new system for the core workflow.
```

### If they ask: `What would you test first?`

Better answer:

```text
I’d start with one safe workflow: read the vendor docs, open the existing portal, fill the profile, upload the files, flag anything missing, and stop before final submit.
```

## What You Should Say Instead Of Technical Claims

Never say:

- `the models are smart enough`
- `it can do everything`
- `it will know`

Say this instead:

- `I want to design it so it stops when confidence is low or something looks incomplete.`
- `I’d start with fill-but-don’t-submit mode.`
- `I’m focused on making one workflow useful and safe before trying to automate more.`

## The Buyer’s Hidden Question

The buyer is often really asking:

- `Can I trust this not to create a mess?`

Your answer should always point back to:

- human review
- stop before final submit
- clear reason when blocked
- existing browser workflow

## What A Good Discovery Answer Sounds Like

If they ask what you are building, a good answer is:

```text
I’m building a browser-based assistant for repetitive portal work.

The kind of workflow I’m focusing on is where someone has to open a portal, fill company details, upload the right documents, check what’s missing, and stop before final submit.

I’m early, so the goal right now is not broad automation. It’s making one workflow useful and safe.
```

## What A Bad Answer Sounds Like

Bad answer:

```text
It’s a browser automation tool that can do repetitive boring tasks.
```

Why this is bad:

- too broad
- sounds like a toy
- does not show you understand their work

## What A Better Practice Answer Would Have Been

Instead of saying this:

- `I am trying to build a browser automation tool which does all the repetitive boring tasks`

Say this:

```text
I’m building a browser-based assistant for repetitive portal work, especially workflows like vendor setup where someone has to enter company details, upload documents, check what’s missing, and still stay in control before anything gets submitted.

I’m early and I’m trying to understand this workflow properly before I build further.
```

## What You Need To Learn Before The Next Practice Call

You do not need to become a procurement expert.

You just need to remember:

- vendor = company they want to work with
- onboarding = getting vendor added correctly
- compliance = making sure required docs and rules are satisfied
- pain = repetitive data entry, uploads, missing docs, wrong docs, and approvals
- value = faster prep, fewer mistakes, human stays in control

## Your Mental Model For The Call

Think this, not startup words:

- they add vendors
- they collect docs
- they fill portals
- they upload files
- they worry about mistakes
- they want speed but not risk

If you keep that in your head, your questions will sound much better.

## The Simplest Script

If you freeze, just say this:

```text
I’m trying to understand one workflow really well.

When your team adds a new vendor, how do they collect the documents, fill the portal, check what’s missing, and decide it is ready for review?
```

Then keep asking about:

- documents
- portal steps
- what gets repeated
- what goes wrong
- what needs approval
