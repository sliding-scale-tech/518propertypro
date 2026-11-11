# Simplr × 518 Property Pro — Sarah Configuration

**Source file:** `Simplr × 518 Property Pro — Sarah Configuration.docx` (repo root). The document has no header/footer text.

## What this doc is

The call-handling configuration spec for "Sarah", the AI voice agent, for 518 Property Pro. It lists, per call type, the questions Sarah must ask, the actions/routing that follow, the scripts and policies supplied by Pat (maintenance lead), the emergency instructions, rent/late-fee and payment policy, and the items Pat must still confirm or approve before each flow goes live. It ends with the configurability requirements for engineering.

## Key facts & rules

- Call types covered (14 sections): leasing inquiries, maintenance calls, maintenance request workflow, emergency calls, rent due/late fees, portal login problems, applying for an apartment, eviction notice/late rent, lease non-renewal, work-order status, lease renewal, vendor payment status, owner call routing, and engineering configuration requirements.
- Leasing intake fields: bedrooms, monthly budget, third-party payer (name/phone/email if yes), preferred communities or communities to avoid in the Capital Region, pets (type/number), preferred move-in date, other info. Save in the lead record; answer availability from current unit info; schedule tours from team calendar availability; route property owners wanting to hire 518 Property Pro to Alex.
- Maintenance basics: name, apartment address, unit number, issue, when first noticed/reported, pets, convenient time to meet a technician. Sarah identifies the unit and auto-routes to its designated asset manager.
- Issue-specific: electrical (breaker/GFI check, only when relevant and safe); water leak (floor, exact location, unit above, bathroom/kitchen above; photo/video if safe; bucket under leak; roof assessment may wait for rain/storm/snow); broken items (what, exact location, duration, photo).
- Tenant-responsibility items (not replaced by Property Pro): expired lightbulbs, broken window blinds, trash to the curb. Neighbor disputes go to local law enforcement. Exact wording needs Pat's approval.
- Workflow: Sarah captures → system routes to the unit's asset manager → asset manager reviews (clarify, request photos/videos, or close if not company responsibility) → forwards validated requests to Pat → Pat decides on formal work order and assigns technician → technician completes and uploads photos, receipts, hours, expenses. Authorized staff can also create tasks/work orders manually.
- Emergencies: Fire → leave building, call 911. Flooding → move to a safe place away from the water, call **518-365-0996** immediately. Gas odor with hissing → leave, call 911, notify other tenants from outside if possible; slight odor without hissing → leave, contact the applicable utility. Pat must confirm exact scripts, severity definitions, numbers and escalation rules before go-live; Sarah must never guess emergency contact details.
- Rent policy: due on the 1st; five-day grace period; computer-generated late notice on the 6th day; rent not paid in full before the 6th day incurs a $50 late fee. Payment methods: check, certified check or cash at the office; debit/credit card by phone to the office; online by debit/credit card. Pat to confirm wording.
- Eviction/late-rent and lease-renewal wording requires Pat's approval; Sarah gives no legal advice, does not promise payment-plan approval, does not promise any security-deposit outcome, and must not claim a lease was generated/sent unless the system confirms.
- Portal login: ask for email; intended action is a password-reset email; engineering must confirm if Simplr can trigger it, otherwise collect details and route to office.
- Application instructions: 518propertypro.com, yellow "View" tab at top-right (double-click) to reach the rental application; confirm still current.
- Work-order status: ask name/address/unit/issue/first-report date; give recorded status only if live lookup is supported, otherwise route without inventing a status.
- Vendor payment status: direct to Delia in accounting (her correct contact details still needed from Pat).
- Owner call-routing menu: 1 Pat Fiore, 2 Alex Buell, 3 Nikki, 4 Nina, 5 Delia (Accounting), 6 Alyssa; numbers/extensions, after-hours behavior and no-answer fallback to be confirmed.
- Everything listed in section 14 (call types, question order, required/optional, conditional follow-ups, approved wording, severity rules/escalation contacts, unit-to-manager assignments, team contacts/routing, failure/missing-info behavior, which flows are enabled for the pilot) should be configurable.

---

# Full content (transcribed from the source document)

# **Simplr × 518 Property Pro — Sarah Configuration**

## **1. Leasing Inquiries**

Sarah should collect the following information from prospective tenants:

- Preferred number of bedrooms

- Monthly rental budget

- Whether they work with a third-party payer

- If yes, the payer's name, phone number and email

- Preferred community or communities they want to avoid in the Capital Region

- Whether they have pets; if yes, the type and number

- Preferred move-in date

- Any other relevant information

Actions:

- Capture the answers in the lead record.

- Answer availability questions using current unit information.

- Schedule tours using the team's calendar availability.

- Route property owners interested in hiring 518 Property Pro to Alex.

## **2. Maintenance Calls**

### **Basic Questions**

Sarah should ask:

- What is your name?

- What is your apartment address?

- What is your unit number?

- What maintenance issue are you concerned about?

- When did you first notice or report the issue?

- Do you have a pet? If yes, what type and how many?

- When would it be convenient for you to meet a technician, if necessary?

Sarah should identify the unit and automatically route the request to its designated asset manager.

### **Electrical Issues**

Ask:

- Did you check your electrical breaker box or the GFI outlet to see if a breaker has tripped?

Only use this question when relevant and safe.

### **Water Leaks**

Ask:

- What floor do you live on?

- Where exactly is the leak?

- Is there an apartment above you, or do you live on the top floor?

- If the leak is in a bathroom or kitchen, is there a bathroom or kitchen directly above it?

Additional instructions from Pat:

- Request a photo or short video of the leak, if possible and safe.

- Ask the tenant to put a bucket under the leak.

- If the tenant lives on the top floor and it is raining, storming or there is standing snow on the roof, explain that roof assessment may need to wait until conditions improve.

### **Broken Items**

For broken windows, doors, cabinets, ceiling tiles or similar issues:

- Ask what is broken.

- Ask for the exact location and how long the issue has existed.

- Request a photo where possible.

Sarah should collect sufficient information to help the team determine the appropriate technician.

### **Tenant-Responsibility Items**

According to Pat's current policy, Property Pro does not replace:

- Expired lightbulbs

- Broken window blinds

- Trash that needs to be taken to the curb

Pat should approve the exact wording Sarah uses to explain this policy.

### **Neighbor Disputes**

Pat's instruction is that arguments, loud or offensive behavior, and similar neighbor disputes should be directed to local law enforcement.

The exact response should be approved by Pat before activation.

## **3. Maintenance Request Workflow**

The workflow must be:

1.  Sarah answers the call and captures the maintenance request.

2.  The system identifies the unit and routes the request to its designated asset manager.

3.  The asset manager reviews the request and can ask for clarification, request photos/videos, or close it if it is not the company's responsibility.

4.  The asset manager forwards validated requests to Pat.

5.  Pat decides whether to create a formal work order and assigns it to a technician.

6.  The technician receives the work order, completes the tasks, and uploads photos, receipts, hours and expenses.

Authorized staff should also be able to create tasks and work orders manually.

## **4. Emergency Calls**

### **Fire**

Pat's supplied instruction:

- Immediately leave the building.

- Call 911.

### **Flooding**

Pat's supplied instruction:

- Move to a safe place away from the water.

- Immediately call 518-365-0996.

### **Gas Leak or Natural Gas Odor**

If there is a gas odor and a hissing noise:

- Leave the building immediately.

- Call 911.

- If possible, notify other tenants from outside the building.

If there is a slight gas odor without hissing:

- Leave the building immediately.

- Contact the applicable utility provider.

Important: Pat must confirm the exact scripts, severity definitions, contact numbers and escalation rules before these flows go live. Sarah must not guess emergency contact details.

## **5. Rent Due and Late Fees**

According to Pat's notes:

- Rent is due on the 1st of each month.

- There is a five-day grace period.

- A computer-generated late notice is sent on the 6th day.

- Rent not paid in full before the 6th day results in a $50 late fee.

Payment methods listed by Pat:

- Mail or bring a check to the office.

- Mail or bring a certified check to the office.

- Bring cash to the office.

- Call the office with a debit or credit card.

- Pay online with a debit or credit card.

Pat should confirm the exact policy wording and current payment instructions.

## **6. Portal Login Problems**

Sarah should ask:

- What is your current email address?

Expected action:

- Send a password-reset email so the tenant can access the portal.

Engineering must confirm whether Simplr can trigger this reset directly. Otherwise, Sarah should collect the details and route the request to the office.

## **7. Applying for an Apartment**

Pat's supplied instructions:

- Visit 518propertypro.com.

- Find the yellow “View” tab at the top-right corner.

- Double-click “View” to access the rental application.

- Complete and submit the application through the website.

Confirm that these website instructions are still current.

## **8. Eviction Notice or Late Rent**

Pat's supplied response covers:

- Explaining that the notice relates to unpaid rent or late fees under the lease.

- Directing the tenant to pay the outstanding amount using the approved payment methods.

- Alternatively, asking the tenant to contact their asset manager immediately to discuss a payment plan.

- Explaining that Pat's current policy requires at least some payment before a payment plan is entered into.

For tenants expecting to be late with rent, Pat wants Sarah to use the same approved guidance about contacting the asset manager.

Pat must approve this wording before activation, as it concerns eviction and legal matters. Sarah should not offer legal advice or promise that a payment plan will be approved.

## **9. Lease Non-Renewal**

If a tenant says they will not renew, Sarah should ask:

- May I ask why?

- What is your anticipated move-out date?

- What days and times are you available for the move-out walkthrough?

Pat's supplied process:

- The tenant meets their asset manager or another Property Pro employee on move-out day or within a day or two afterward.

- The team conducts a walkthrough and collects the keys.

- The team assesses whether any security deposit will be returned.

Sarah must not promise a particular security-deposit outcome.

## **10. Work-Order Status**

If a tenant calls to check on an existing work order, Sarah should ask:

- What is your name?

- What is your address?

- What is your unit number?

- What is the maintenance issue?

- When did you first report the issue?

If live work-order lookup is supported, Sarah can provide the recorded status. Otherwise, she should route the query to the relevant team member without inventing a status.

## **11. Lease Renewal**

Sarah should ask:

- What is your name?

- What is your address?

- What is your unit number?

- When does your lease expire?

- What is your current email address?

Pat's supplied process:

- Generate a new lease for the tenant's review and email it to them.

- Direct questions or concerns about the lease to their asset manager.

- If the tenant does not know their asset manager, capture that information and route it to staff.

- If the tenant agrees to the proposed lease, ask them to sign, date and return it.

Pat's note states that a binding agreement requires signatures from both the tenant and a Property Pro Realty Group Inc. representative.

Confirm whether lease generation and emailing are part of the initial release. Sarah must not claim a lease has been generated or sent unless the system confirms it.

## **12. Vendor Payment Status**

If a vendor or another caller asks about payment status:

- Direct them to Delia in the accounting department.

Pat still needs to provide Delia's correct contact details.

If Sarah cannot check payment status directly, she should route the query or take a message.

## **13. Owner Call Routing**

Pat provided these phone-menu options:

- Press 1 for Pat Fiore.

- Press 2 for Alex Buell.

- Press 3 for Nikki.

- Press 4 for Nina.

- Press 5 for Delia in Accounting.

- Press 6 for Alyssa.

Confirm the phone numbers or extensions, after-hours behavior and fallback if someone does not answer.

## **14. Configuration Requirements for Engineering**

Make the following configurable wherever practical:

- Which call types Sarah handles.

- Questions and their order for each call type.

- Required and optional questions.

- Conditional follow-up questions.

- Approved response wording.

- Emergency severity rules and escalation contacts.

- Unit-to-asset-manager assignments.

- Team member contact information and owner call-routing destinations.

- What Sarah does when information is missing or a system lookup fails.

- Which call flows are enabled for the pilot.
