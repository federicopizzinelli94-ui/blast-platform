import os
import json
import time
import threading
from pathlib import Path
from dotenv import load_dotenv
from serpapi import GoogleSearch
from supabase import create_client, Client
from extract_emails import extract_contacts_from_url
from evaluate_lead import evaluate_lead_prefilter

load_dotenv(Path(__file__).parent / '.env')

# Config
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SERPAPI_KEY = os.environ.get("SERPAPI_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Global job status tracking ──
# Stores results for each search job so the API can poll them
search_jobs = {}
search_jobs_lock = threading.Lock()

DEFAULT_MIN_SCORE = 50
SEARCH_TIMEOUT_SECONDS = 300  # 5 minutes

def is_stop_requested(job_id):
    """Check if this job has been flagged for stopping (manual or timeout)."""
    with search_jobs_lock:
        job = search_jobs.get(job_id)
        if not job:
            return True
        return job.get("stop_requested", False)

# Province abbreviation mapping for common Italian cities
CITY_TO_PROVINCE = {
    "milano": "MI", "roma": "RM", "torino": "TO", "napoli": "NA",
    "bologna": "BO", "firenze": "FI", "genova": "GE", "venezia": "VE",
    "palermo": "PA", "bari": "BA", "catania": "CT", "verona": "VR",
    "padova": "PD", "brescia": "BS", "bergamo": "BG", "modena": "MO",
    "parma": "PR", "reggio emilia": "RE", "perugia": "PG", "livorno": "LI",
    "cagliari": "CA", "trieste": "TS", "ancona": "AN", "lecce": "LE",
    "como": "CO", "varese": "VA", "monza": "MB", "pavia": "PV",
    "cremona": "CR", "mantova": "MN", "lodi": "LO", "sondrio": "SO",
    "lecco": "LC", "rimini": "RN", "pesaro": "PU", "ravenna": "RA",
    "piacenza": "PC", "ferrara": "FE", "forlì": "FC", "cesena": "FC",
    "trento": "TN", "bolzano": "BZ", "udine": "UD", "pordenone": "PN",
    "vicenza": "VI", "treviso": "TV", "belluno": "BL", "rovigo": "RO",
    "alessandria": "AL", "asti": "AT", "cuneo": "CN", "novara": "NO",
    "vercelli": "VC", "biella": "BI", "savona": "SV", "imperia": "IM",
    "la spezia": "SP", "lucca": "LU", "pisa": "PI", "arezzo": "AR",
    "siena": "SI", "grosseto": "GR", "pistoia": "PT", "prato": "PO",
    "massa": "MS", "terni": "TR", "macerata": "MC", "ascoli piceno": "AP",
    "teramo": "TE", "pescara": "PE", "chieti": "CH", "l'aquila": "AQ",
    "campobasso": "CB", "isernia": "IS", "caserta": "CE", "salerno": "SA",
    "avellino": "AV", "benevento": "BN", "foggia": "FG", "taranto": "TA",
    "brindisi": "BR", "potenza": "PZ", "matera": "MT", "cosenza": "CS",
    "catanzaro": "CZ", "reggio calabria": "RC", "crotone": "KR", "vibo valentia": "VV",
    "messina": "ME", "siracusa": "SR", "ragusa": "RG", "agrigento": "AG",
    "caltanissetta": "CL", "enna": "EN", "trapani": "TP",
    "sassari": "SS", "nuoro": "NU", "oristano": "OR",
}


# ═══════════════════════════════════════════
# 🛑 Custom Exception Hierarchy
# ═══════════════════════════════════════════
class SearchError(Exception):
    """Base error for search pipeline."""
    def __init__(self, message, code=None, details=None):
        super().__init__(message)
        self.code = code
        self.details = details or {}

class SerpAPIError(SearchError):
    """SerpAPI call failed after retries."""
    pass

class BufferExhaustedError(SearchError):
    """Not enough results from SerpAPI to satisfy requested limit."""
    pass


# ═══════════════════════════════════════════
# 🔄 Retry Decorator (Exponential Backoff)
# ═══════════════════════════════════════════
def retry(max_attempts=3, backoff_factor=2.0, exceptions=(Exception,)):
    """Retry decorator with exponential backoff."""
    from functools import wraps

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt < max_attempts - 1:
                        sleep_time = backoff_factor ** attempt
                        print(f"   ⚠️ {func.__name__} failed (attempt {attempt+1}/{max_attempts}): {e} — retrying in {sleep_time}s...")
                        time.sleep(sleep_time)
                    else:
                        print(f"   ❌ {func.__name__} failed after {max_attempts} attempts: {e}")
            raise last_exception
        return wrapper
    return decorator


# ═══════════════════════════════════════════
# 🔎 SerpAPI Fetch with Retry
# ═══════════════════════════════════════════
@retry(max_attempts=2, backoff_factor=2.0, exceptions=(Exception,))
def fetch_serpapi_results(query, offset=0):
    """Fetch a page of Google Maps results via SerpAPI, with retry on failure."""
    params = {
        "engine": "google_maps",
        "q": query,
        "type": "search",
        "api_key": SERPAPI_KEY,
        "hl": "it",
        "gl": "it",
        "start": offset,
    }

    search = GoogleSearch(params)
    results = search.get_dict()

    if "error" in results:
        raise SerpAPIError(
            f"SerpAPI returned error: {results['error']}",
            code="SERPAPI_ERROR",
            details={"query": query, "offset": offset}
        )

    local_results = results.get("local_results", [])
    if "place_results" in results:
        local_results = [results["place_results"]]

    return local_results


def search_leads(product_id, location="Italia", limit=10, min_score=DEFAULT_MIN_SCORE, job_id=None, include_province=False):
    """
    Executes Google Maps search based on a Product's target keywords.
    PRE-FILTERS leads by AI score before inserting into DB.
    Uses SerpAPI PAGINATION to ensure we find enough leads.
    Only counts leads with score >= min_score toward the requested limit.
    
    Args:
        include_province: If True, matches results in the entire province (e.g. Milano matches all MI)

    Returns { accepted: [...], discarded: [...], below_threshold: [...], stats: {...} }
    """
    # Initialize job tracking
    if job_id:
        with search_jobs_lock:
            search_jobs[job_id] = {
                "status": "running",
                "progress": "Avvio ricerca...",
                "product_id": product_id,
                "accepted": [],
                "discarded": [],
                "below_threshold": [],
                "stats": {"analyzed": 0, "accepted": 0, "discarded": 0, "below_threshold": 0, "avg_score": 0},
                "created_at": time.time(),
                "stop_requested": False
            }

    search_start_time = time.time()

    def update_job(progress=None, **kwargs):
        if job_id:
            with search_jobs_lock:
                if progress:
                    search_jobs[job_id]["progress"] = progress
                for k, v in kwargs.items():
                    search_jobs[job_id][k] = v

    # 1. Fetch Product Details
    print(f"📦 Fetching Product {product_id}...")
    update_job(progress="Recupero dettagli prodotto...")

    product_res = supabase.table("products").select("*").eq("id", product_id).execute()
    if not product_res.data:
        print("❌ Product not found.")
        update_job(status="error", progress="Prodotto non trovato")
        return {"accepted": [], "discarded": [], "stats": {}}

    product = product_res.data[0]

    # Smart Query Construction — build list of queries from target_keywords
    raw_keywords = product.get("target_keywords")
    if not raw_keywords:
        raw_keywords = product.get("description")
    if not raw_keywords:
        raw_keywords = product.get("name")

    # Split comma-separated keywords into individual queries
    query_list = [kw.strip() for kw in raw_keywords.split(",") if kw.strip()]
    if not query_list:
        query_list = [raw_keywords]

    # Also add product name as fallback query if not already in list
    product_name = product.get("name", "")
    if product_name and product_name.lower() not in [q.lower() for q in query_list]:
        query_list.append(product_name)

    print(f"🎯 Strategy: {len(query_list)} queries to try: {query_list} in '{location}' (min_score: {min_score})")
    update_job(progress=f"Ricerca in '{location}' con {len(query_list)} query...")

    # ══════════════════════════════════════════════════════════
    # 🔄 ROUND-ROBIN MULTI-QUERY SEARCH
    # Cycles through keywords one page at a time:
    #   Page 1 of KW1 → Page 1 of KW2 → ... → Page 2 of KW1 → ...
    # Ensures variety across sectors and no duplicates.
    # ══════════════════════════════════════════════════════════

    MAX_PAGES_PER_QUERY = 10
    visited_websites = set()

    accepted = []
    discarded = []
    below_threshold = []
    all_scores = []
    accepted_count = 0
    analyzed_count = 0
    total_pages = 0

    # Track per-query state: current page number and whether exhausted
    query_states = []
    for qkw in query_list:
        query_states.append({
            "keyword": qkw,
            "full_query": f"{qkw} a {location}",
            "page": 0,           # next page to fetch (0-indexed, will increment before use)
            "offset": 0,         # SerpAPI offset
            "exhausted": False,  # True when no more results
        })

    print(f"\n🚀 Round-robin search: {len(query_list)} keywords, cycling 1 page each...")
    print(f"   Keywords: {query_list}")
    update_job(progress=f"Avvio ricerca round-robin con {len(query_list)} keyword...")

    try:
        search_done = False

        while not search_done:
            # Check for stop request or timeout
            if job_id and is_stop_requested(job_id):
                print(f"🛑 Job {job_id} stop requested — exiting gracefully.")
                break
            if job_id and (time.time() - search_start_time) > SEARCH_TIMEOUT_SECONDS:
                print(f"⏱️ Job {job_id} timed out after 5 minutes — exiting gracefully.")
                with search_jobs_lock:
                    search_jobs[job_id]["stop_requested"] = True
                break

            # Check if ALL queries are exhausted
            all_exhausted = all(qs["exhausted"] for qs in query_states)
            if all_exhausted:
                print("⚠️  All queries exhausted — no more results available.")
                break

            # Cycle through each keyword, one page each
            for qs in query_states:
                # Check stop between keywords
                if job_id and (is_stop_requested(job_id) or (time.time() - search_start_time) > SEARCH_TIMEOUT_SECONDS):
                    search_done = True
                    break

                if accepted_count >= limit:
                    search_done = True
                    break

                if qs["exhausted"]:
                    continue

                if qs["page"] >= MAX_PAGES_PER_QUERY:
                    qs["exhausted"] = True
                    print(f"   🔚 Max pages reached for '{qs['keyword']}'")
                    continue

                qs["page"] += 1
                total_pages += 1
                keyword = qs["keyword"]

                print(f"\n📄 [{keyword}] Pagina {qs['page']} (offset: {qs['offset']})...")
                update_job(progress=f"🔍 \"{keyword}\" — pagina {qs['page']}... ({accepted_count}/{limit} trovati)")

                try:
                    page_results = fetch_serpapi_results(qs["full_query"], offset=qs["offset"])
                except SerpAPIError as e:
                    print(f"❌ SerpAPI Error for '{keyword}': {e}")
                    qs["exhausted"] = True
                    continue

                if not page_results:
                    print(f"⚠️  No results on page {qs['page']} for '{keyword}'. Query exhausted.")
                    qs["exhausted"] = True
                    continue

                print(f"   📊 Got {len(page_results)} results")
                qs["offset"] += 20

                for item in page_results:
                    # Check stop between individual leads
                    if job_id and is_stop_requested(job_id):
                        search_done = True
                        break

                    if accepted_count >= limit:
                        break

                    company_name = item.get("title")
                    website = item.get("website")
                    phone = item.get("phone")
                    address = item.get("address")

                    if not website:
                        continue

                    # Deduplication (in-memory)
                    if website in visited_websites:
                        continue
                    visited_websites.add(website)

                    # DB duplicate check
                    try:
                        existing_web = supabase.table("leads").select("id").eq("website", website).execute()
                        if existing_web.data:
                            print(f"⏩ Skip duplicate (DB): {company_name}")
                            continue
                    except Exception as db_err:
                        print(f"   ⚠️ DB check error for {company_name}: {db_err}")

                    analyzed_count += 1
                    update_job(progress=f"\"{keyword}\" — Analisi AI: {company_name}...")

                    # AI Pre-filter
                    eval_result = evaluate_lead_prefilter(
                        company_name=company_name,
                        website=website,
                        location=address or location,
                        product=product
                    )

                    score = eval_result["score"]
                    reason = eval_result["reason"]

                    lead_summary = {
                        "company_name": company_name,
                        "website": website,
                        "location": address or location,
                        "phone": phone,
                        "score": score,
                        "reason": reason,
                        "sector_match": eval_result.get("sector_match", 0),
                        "purchase_potential": eval_result.get("purchase_potential", 0),
                        "complementarity": eval_result.get("complementarity", 0),
                        "web_quality": eval_result.get("web_quality", 0)
                    }

                    # Score 0 = unreachable site
                    if score == 0:
                        print(f"   🚫 SKIP (score 0): {company_name} — {reason}")
                        discarded.append(lead_summary)
                        continue

                    all_scores.append(score)

                    # Location check
                    if address and location and location.lower() != "italia":
                        loc_lower = location.lower().strip()
                        addr_lower = (address or "").lower()
                        loc_words = [w for w in loc_lower.split() if len(w) > 2]
                        location_match = any(w in addr_lower for w in loc_words)

                        if not location_match and include_province:
                            province_code = CITY_TO_PROVINCE.get(loc_lower)
                            if province_code:
                                addr_upper = (address or "").upper()
                                location_match = (
                                    addr_upper.endswith(f" {province_code}") or
                                    f" {province_code} " in addr_upper or
                                    f"({province_code})" in addr_upper or
                                    f" {province_code}," in addr_upper
                                )
                                if location_match:
                                    print(f"   📍 Province match: {company_name} — '{address}' in {province_code}")

                        if not location_match:
                            print(f"   📍 SKIP (location mismatch): {company_name} — '{address}' vs '{location}'")
                            lead_summary["reason"] = f"Località non corrispondente: {address} vs {location}"
                            discarded.append(lead_summary)
                            continue

                    quality_label = "🟢 TOP" if score >= min_score else "🟡 BELOW"
                    print(f"   {quality_label}: {company_name} (Score: {score})")

                    # Below threshold
                    if score < min_score:
                        print(f"   ⏭️  Below {min_score}%: {company_name} (Score: {score})")
                        below_threshold.append(lead_summary)
                        continue

                    # GUARD: re-check limit before expensive enrichment + insert
                    if accepted_count >= limit:
                        break

                    # Enrich with email/phone
                    contacts = extract_contacts_from_url(website)
                    best_email = contacts['emails'][0] if contacts['emails'] else None
                    scraped_phone = contacts['phones'][0] if contacts['phones'] else None
                    source = "Website Scraper" if best_email else "None"
                    final_phone = phone or scraped_phone

                    lead_data = {
                        "company_name": company_name,
                        "website": website,
                        "location": address or location,
                        "phone": final_phone,
                        "industry_vertical": keyword,
                        "status": "New",
                        "email": best_email,
                        "best_email_source": source,
                        "interested_product_id": product_id,
                        "match_score": score,
                        "match_reason": reason,
                        "notes": f"AI Score: {score}/100 for {product['name']}"
                    }

                    try:
                        data = supabase.table("leads").insert(lead_data).execute()
                        lead_summary["id"] = data.data[0]["id"] if data.data else None
                        lead_summary["email"] = best_email
                        accepted.append(lead_summary)
                        accepted_count += 1
                        print(f"   ✅ ACCEPTED [{keyword}]: {company_name} (Score: {score}) — {accepted_count}/{limit}")
                    except Exception as insert_error:
                        print(f"   ❌ Insert error: {insert_error}")

                # Update job after each keyword page
                avg_so_far = round(sum(all_scores) / len(all_scores)) if all_scores else 0
                update_job(
                    progress=f"Trovati {accepted_count}/{limit}... Round-robin pagina {qs['page']} di \"{keyword}\"",
                    stats={
                        "analyzed": analyzed_count,
                        "accepted": accepted_count,
                        "discarded": len(discarded),
                        "below_threshold": len(below_threshold),
                        "avg_score": avg_so_far
                    },
                    accepted=accepted,
                    discarded=discarded,
                    below_threshold=below_threshold
                )

                # Rate-limit between SerpAPI calls
                time.sleep(0.7)

        # ── Final stats ──
        valid_scores = [s for s in all_scores if s > 0]
        avg_score = round(sum(valid_scores) / len(valid_scores)) if valid_scores else 0

        warning = None
        if accepted_count < limit:
            warning = f"Trovati solo {accepted_count}/{limit} lead con score ≥ {min_score} dopo aver analizzato {analyzed_count} risultati su {total_pages} pagine ({len(query_list)} keyword round-robin)"

        stats = {
            "analyzed": analyzed_count,
            "accepted": len(accepted),
            "discarded": len(discarded),
            "below_threshold": len(below_threshold),
            "avg_score": avg_score,
            "min_score_threshold": min_score,
            "product_name": product["name"],
            "location": location,
            "pages_searched": total_pages,
            "warning": warning
        }

        print(f"\n{'='*60}")
        print(f"🎉 Search Complete for {product['name']} in {location}")
        print(f"   📄 SerpAPI Pages: {total_pages} (round-robin across {len(query_list)} keywords)")
        print(f"   📊 Analyzed: {analyzed_count}")
        print(f"   ✅ Accepted: {len(accepted)} (score ≥ {min_score})")
        print(f"   🟡 Below threshold: {len(below_threshold)} (score < {min_score})")
        print(f"   ❌ Discarded: {len(discarded)} (score 0 or location mismatch)")
        print(f"   📈 Average Score: {avg_score}")
        if warning:
            print(f"   ⚠️  {warning}")
        print(f"{'='*60}\n")

        # Determine if this was a stop/timeout
        was_stopped = job_id and is_stop_requested(job_id)
        was_timeout = was_stopped and (time.time() - search_start_time) > SEARCH_TIMEOUT_SECONDS

        if was_timeout:
            final_progress = f"Non sono stati trovati ulteriori contatti. Trovati {accepted_count} lead in 5 minuti"
        elif was_stopped:
            final_progress = f"Ricerca interrotta. Trovati {accepted_count} lead qualificati"
        elif accepted_count >= limit:
            final_progress = f"Ricerca completata! Trovati {accepted_count} lead qualificati"
        elif accepted_count > 0:
            final_progress = f"Ricerca completata. Trovati {accepted_count}/{limit} lead qualificati (risultati esauriti)"
        else:
            final_progress = f"Ricerca completata. Nessun lead con score ≥ {min_score} trovato"

        result = {"accepted": accepted, "discarded": discarded, "below_threshold": below_threshold, "stats": stats}
        stopped_reason = "timeout" if was_timeout else ("manual" if was_stopped else None)
        update_job(status="completed", progress=final_progress, completed_at=time.time(), stopped_reason=stopped_reason, **result)
        return result

    except Exception as e:
        print(f"❌ Critical Error in search_leads: {e}")
        update_job(status="error", progress=f"Errore critico: {str(e)}", completed_at=time.time())
        return {"accepted": [], "discarded": [], "stats": {}}


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        pid = sys.argv[1]
        loc = sys.argv[2] if len(sys.argv) > 2 else "Italia"
        lim = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        ms = int(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_MIN_SCORE
        result = search_leads(pid, loc, lim, ms)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("Usage: python search_leads.py <product_uuid> [location] [limit] [min_score]")
