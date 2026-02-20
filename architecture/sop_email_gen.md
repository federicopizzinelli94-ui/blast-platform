# SOP: Email Generation Protocol

## Goal
Generate a personalized cold outreach email for a specific lead using AI (OpenAI).

## Inputs
1.  `lead_data` (dict):
    *   `company_name`
    *   `industry_vertical` (e.g., "Aziende vinicole")
    *   `location`
    *   `website`
2.  `product_context` (string): Description of what we make (e.g., "Taglio laser, premi, etichette").

## Logic
1.  **Analyze Context**: Determine the "Hook" based on vertical.
    *   *Vinicole*: Focus on "Etichette premium" and "Cassette vino".
    *   *Premi*: Focus on "Trofei aziendali" and "Riconoscimenti".
    *   *Cosmetica*: Focus on "Packaging lusso".
2.  **Prompt Engineering**:
    *   Role: "Expert B2B Sales Copywriter".
    *   Tone: Professional, Italian, Respectful but direct.
    *   Structure:
        *   Subject Line (Short, relevant).
        *   Salutation (Professional).
        *   The "Why You" (Reference their industry/location).
        *   The "What We Do" (Specific solution for them).
        *   Call to Action (Meeting/Call).
3.  **Generation**: Call OpenAI GPT-4o.
4.  **Output**: JSON object with `subject` and `body`.
5.  **Save**: Update the `leads` table (or separate `campaigns` table) with the drafted email.

## Edge Cases
- **Missing Data**: If specific company details are vague, keep the hook generic to the industry.
- **Language**: Strictly Italian.
