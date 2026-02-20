# SOP: Lead Search Protocol

## Goal
Find potential B2B leads based on a specific "Vertical" and "Location" using Google Maps data via SerpAPI.

## Inputs
1.  `query` (string): The search term (e.g., "Aziende vinicole").
2.  `location` (string): The geographic area (e.g., "Franciacorta, Brescia").
3.  `limit` (int): Max results to fetch (default: 10).

## Logic (The "How-To")
1.  **Construct Query**: Combine vertical + location (e.g., "Aziende vinicole in Franciacorta").
2.  **Call SerpAPI**: Use `google_maps` engine.
3.  **Filter Results**:
    *   Must have a `title` (Company Name).
    *   Must have a `website` (Critical for contact info).
    *   Must have a `place_id` (Unique ID).
4.  **Deduplication**: Check Supabase `leads` table. If `website` OR `company_name` exists, SKIP.
5.  **Save to Database**: Insert new leads into Supabase with status `New`.

## Output
*   List of JSON objects representing the newly added leads.
*   Log of duplicates skipped.

## Edge Cases
*   **No Website**: If a result has no website, store it but flag it? -> *DECISION*: Skip for now. We need email/web to contact.
*   **Rate Limits**: Handle SerpAPI errors gracefully.
*   **Zero Results**: Return empty list, do not crash.
