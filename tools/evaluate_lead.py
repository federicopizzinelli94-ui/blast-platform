import os
import requests
import json
import time
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client
from bs4 import BeautifulSoup
from openai import OpenAI

load_dotenv(Path(__file__).parent / '.env')

# Config
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_API_KEY)

def scrape_text_content(url, max_chars=5000):
    """
    Fetches URL and returns stripped text content.
    Visits homepage + key pages for deeper context.
    """
    if not url.startswith("http"):
        url = "https://" + url

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    all_text = []
    visited = set()
    from urllib.parse import urljoin, urlparse

    base_domain = urlparse(url).netloc
    pages = [url]

    # Add key pages for deeper context
    for path in ["/chi-siamo", "/about", "/about-us", "/servizi", "/services", "/prodotti", "/products"]:
        pages.append(urljoin(url, path))

    for page_url in pages:
        if page_url in visited or len(visited) >= 4:
            break
        visited.add(page_url)

        # Retry each page fetch (max 2 attempts, 1s backoff)
        for attempt in range(2):
            try:
                resp = requests.get(page_url, headers=headers, timeout=5)
                if resp.status_code != 200:
                    break
                if urlparse(resp.url).netloc != base_domain:
                    break

                soup = BeautifulSoup(resp.text, 'html.parser')
                for tag in soup(["script", "style", "nav", "footer", "header"]):
                    tag.decompose()

                text = soup.get_text()
                lines = (line.strip() for line in text.splitlines())
                chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
                clean = '\n'.join(chunk for chunk in chunks if chunk)
                all_text.append(clean)
                break  # Success, no need to retry
            except requests.RequestException:
                if attempt < 1:
                    time.sleep(1)
                    continue
            except Exception:
                break  # Non-network error, don't retry

    combined = '\n---\n'.join(all_text)
    return combined[:max_chars]


def evaluate_lead_prefilter(company_name, website, location, product):
    """
    PRE-FILTER: Evaluates a lead BEFORE inserting into DB.
    Returns dict: { score: int, reason: str, accepted: bool }
    Does NOT require a lead ID — works on raw data.
    """
    print(f"🧠 Pre-filtering: {company_name} vs {product['name']}...")

    website_content = scrape_text_content(website)

    if not website_content or len(website_content) < 50:
        print(f"   ⚠️ Not enough content for {company_name}.")
        return {
            "score": 0,
            "reason": "Sito web non raggiungibile o contenuto insufficiente per l'analisi.",
            "accepted": False
        }

    prompt = f"""
    Sei un esperto Lead Scorer B2B. Il tuo compito è valutare con ESTREMA PRECISIONE
    quanto un potenziale cliente è affine al nostro prodotto.

    ══════ IL NOSTRO PRODOTTO ══════
    Nome: {product['name']}
    Descrizione: {product.get('description', 'N/A')}
    Descrizione AI (da analisi visiva cataloghi/immagini): {product.get('ai_description', 'Non disponibile')}
    Target Keywords: {product.get('target_keywords', 'N/A')}

    ══════ IL POTENZIALE CLIENTE ══════
    Azienda: {company_name}
    Sito Web: {website}
    Localizzazione: {location}
    Contenuto del sito (estratto):
    ---
    {website_content}
    ---

    ══════ CRITERI DI VALUTAZIONE ══════
    Valuta ciascun criterio e poi dai uno score finale composito:

    1. AFFINITÀ SETTORIALE (peso 40%):
       - L'azienda opera nello stesso settore/mercato del nostro prodotto?
       - Produce, vende o utilizza prodotti/servizi dove il nostro sarebbe utile?

    2. POTENZIALE DI ACQUISTO (peso 25%):
       - L'azienda sembra avere dimensioni adeguate?
       - Ha bisogno reale del nostro prodotto basandosi su quello che fa?

    3. COMPLEMENTARITÀ (peso 20%):
       - I loro prodotti/servizi sono complementari ai nostri?
       - C'è una sinergia naturale?

    4. QUALITÀ PRESENZA WEB (peso 15%):
       - Il sito è professionale e aggiornato?
       - L'azienda è strutturata?

    ══════ OUTPUT JSON ══════
    {{
        "score": <int 0-100>,
        "sector_match": <int 0-100>,
        "purchase_potential": <int 0-100>,
        "complementarity": <int 0-100>,
        "web_quality": <int 0-100>,
        "reason": "<spiegazione in italiano, max 2 frasi, stile diretto>"
    }}

    ══════ REGOLE ══════
    - Sii MOLTO SEVERO. Score 80+ solo per match eccellenti.
    - Se l'azienda è completamente off-topic rispetto al prodotto → score 0-15
    - Se c'è affinità vaga ma non diretta → score 20-40
    - Se c'è buona affinità ma non perfetta → score 40-65
    - Se c'è forte affinità settoriale e potenziale reale → score 65-85
    - Score 85+ solo per match quasi perfetti
    """

    # Retry OpenAI call (max 2 attempts, 2s backoff)
    last_error = None
    for attempt in range(2):
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )

            result = json.loads(response.choices[0].message.content)
            score = result.get("score", 0)
            reason = result.get("reason", "Analisi completata.")

            print(f"   {'✅' if score >= 50 else '❌'} Score: {score}/100 - {reason}")

            return {
                "score": score,
                "reason": reason,
                "sector_match": result.get("sector_match", 0),
                "purchase_potential": result.get("purchase_potential", 0),
                "complementarity": result.get("complementarity", 0),
                "web_quality": result.get("web_quality", 0),
                "accepted": True  # Caller decides based on threshold
            }

        except Exception as e:
            last_error = e
            if attempt < 1:
                print(f"   ⚠️ AI Error (attempt {attempt+1}/2): {e} — retrying in 2s...")
                time.sleep(2)
                continue

    # Graceful degradation: return conservative score instead of 0
    print(f"   ⚠️ AI failed after retries: {last_error} — assigning conservative score")
    return {
        "score": 25,
        "reason": f"Score conservativo: analisi AI non disponibile ({str(last_error)[:80]})",
        "sector_match": 0,
        "purchase_potential": 0,
        "complementarity": 0,
        "web_quality": 0,
        "accepted": False
    }


def evaluate_lead(lead, product):
    """
    POST-INSERT evaluation: Analyzes matching between Lead Website Content and Product.
    Updates the lead record in DB. Used for re-scoring existing leads.
    """
    print(f"🧠 AI Analyzing: {lead['company_name']} vs {product['name']}...")

    result = evaluate_lead_prefilter(
        company_name=lead['company_name'],
        website=lead['website'],
        location=lead.get('location', ''),
        product=product
    )

    # Update DB
    supabase.table("leads").update({
        "match_score": result["score"],
        "match_reason": result["reason"]
    }).eq("id", lead['id']).execute()

    return result["score"]


if __name__ == "__main__":
    pass
