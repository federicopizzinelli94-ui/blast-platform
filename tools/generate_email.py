import os
import json
import re
import requests
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client
from bs4 import BeautifulSoup
import anthropic
import locale
from datetime import datetime

load_dotenv(Path(__file__).parent / '.env')

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def scrape_website_deep(url, max_chars=5000):
    """
    Scrapes the website homepage + key pages for deeper context.
    """
    if not url.startswith("http"):
        url = "https://" + url

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    all_text = []
    visited = set()
    from urllib.parse import urljoin, urlparse

    base_domain = urlparse(url).netloc
    pages = [url]

    # Add common pages for more context
    for path in ["/chi-siamo", "/about", "/about-us", "/servizi", "/services", "/prodotti", "/products"]:
        pages.append(urljoin(url, path))

    for page_url in pages:
        if page_url in visited or len(visited) >= 4:
            break
        visited.add(page_url)

        try:
            resp = requests.get(page_url, headers=headers, timeout=5)
            if resp.status_code != 200:
                continue
            if urlparse(resp.url).netloc != base_domain:
                continue

            soup = BeautifulSoup(resp.text, 'html.parser')
            for tag in soup(["script", "style", "nav", "footer", "header"]):
                tag.decompose()

            text = soup.get_text()
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            clean = '\n'.join(chunk for chunk in chunks if chunk)
            all_text.append(clean)
        except Exception:
            pass

    combined = '\n---\n'.join(all_text)
    return combined[:max_chars]


def generate_email_for_lead(lead_id):
    """
    Analyzes the lead's website and generates a personalized cold email
    proposing our product/service, aiming for a discovery call.
    """
    # Fetch lead with product
    response = supabase.table("leads").select("*, products(*)").eq("id", lead_id).execute()
    if not response.data:
        print(f"Lead {lead_id} not found.")
        return None

    lead = response.data[0]
    company_name = lead.get("company_name")
    website = lead.get("website")
    location = lead.get("location", "")

    if not website:
        return {"error": "Nessun sito web disponibile per questo contatto."}

    # Scrape website for context
    print(f"Analyzing website: {website}")
    website_content = scrape_website_deep(website)

    if not website_content or len(website_content) < 50:
        website_content = f"Azienda: {company_name}, Luogo: {location}, Settore: {lead.get('industry_vertical', 'N/A')}"

    # Get product info
    product = lead.get("products")
    product_name = "il nostro servizio"
    product_desc = ""

    if product:
        product_name = product.get("name", product_name)
        product_desc = product.get("description", "")
        ai_desc = product.get("ai_description")
        if ai_desc:
            product_desc = f"{product_desc}\n\nDettagli prodotto (da analisi AI): {ai_desc}"
    elif lead.get("interested_product_id"):
        p_res = supabase.table("products").select("*").eq("id", lead.get("interested_product_id")).execute()
        if p_res.data:
            product_name = p_res.data[0]['name']
            product_desc = p_res.data[0]['description']
            ai_desc = p_res.data[0].get('ai_description')
            if ai_desc:
                product_desc = f"{product_desc}\n\nDettagli prodotto (da analisi AI): {ai_desc}"

    # Get current date in Italian for concrete date references
    try:
        locale.setlocale(locale.LC_TIME, 'it_IT.UTF-8')
    except locale.Error:
        pass  # fallback to default locale
    now = datetime.now()
    date_context = now.strftime("Oggi è %A %d %B %Y, ore %H:%M")

    prompt = f"""
DATA CORRENTE: {date_context}

CHI SIAMO (MITTENTE):
Laser Services — azienda italiana con sede a Cesena (FC), attiva dal 1991. Siamo specializzati nell'applicazione della tecnologia laser in settori innovativi: taglio e incisione laser di precisione su plexiglas, legni, metalli, cuoio, carta, pietra composita e molti altri materiali.
Operiamo nei settori: pubblicita' e segnaletica, arredamento e interior design, ristorazione e hospitality, arte e architettura, oggettistica e regalistica aziendale, cartotecnica, etichette speciali.
Punto di forza: oltre 30 anni di esperienza, personalizzazione totale (non abbiamo articoli di serie), consulenza approfondita su materiali e design, dal concept alla realizzazione.

AZIENDA DESTINATARIA:
- Nome: {company_name}
- Sito web: {website}
- Luogo: {location}
- Contenuto del sito (estratto):
---
{website_content}
---

PRODOTTO/SERVIZIO DA PROPORRE:
- Nome: {product_name}
- Descrizione: {product_desc}

OBIETTIVO:
Scrivere una cold email B2B di presentazione che:
1. Mostri che conosciamo la loro azienda (cita qualcosa di specifico dal loro sito)
2. Colleghi concretamente il nostro prodotto/servizio alle loro esigenze specifiche
3. Proponga un passo successivo concreto (es. call conoscitiva, invio campioni, visita)

REGOLE:
- Massimo 120 parole nel body
- Tono professionale ma cordiale e umano — come un collega esperto che propone una collaborazione, non un venditore
- Non usare frasi fatte tipo "Mi permetto di contattarla", "Gentilissimo", "Egregio"
- Vai dritto al punto, sii specifico e concreto
- NON inserire firma, saluti finali o nome del mittente — il cliente aggiungera' la propria firma
- Chiudi il body con una proposta concreta di call o incontro con data e giorno specifici (basati sulla data corrente)
- Scrivi in italiano

OUTPUT JSON:
{{
    "subject": "Oggetto email (breve, incuriosisce, max 8 parole)",
    "body": "Testo email completo SENZA firma finale",
    "hook": "Frase personalizzata basata sul loro sito (1 riga)"
}}
"""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1024,
            system=f"Sei un copywriter B2B esperto che scrive per conto di Laser Services, azienda di Cesena specializzata in tecnologia laser dal 1991. {date_context}. Quando proponi date per call, usa date concrete e realistiche a partire da domani (es. 'giovedi' 20 febbraio'). Non inserire MAI firma, saluti finali o nome del mittente nel body. Rispondi ESCLUSIVAMENTE con JSON valido, senza testo aggiuntivo prima o dopo.",
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        content = message.content[0].text
        print(f"Raw API response: {content[:500]}")

        # Robust JSON extraction: handle markdown code fences
        json_str = content.strip()
        # Remove ```json ... ``` wrapping if present
        fence_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', json_str, re.DOTALL)
        if fence_match:
            json_str = fence_match.group(1).strip()

        # Try to find JSON object if there's extra text
        if not json_str.startswith('{'):
            brace_match = re.search(r'\{.*\}', json_str, re.DOTALL)
            if brace_match:
                json_str = brace_match.group(0)

        email_data = json.loads(json_str)

        # Save to lead
        supabase.table("leads").update({
            "generated_email": json.dumps(email_data, ensure_ascii=False)
        }).eq("id", lead_id).execute()

        print(f"✅ Email generated for {company_name}")
        return email_data

    except Exception as e:
        print(f"❌ Error generating email: {e}")
        return {"error": str(e)}
