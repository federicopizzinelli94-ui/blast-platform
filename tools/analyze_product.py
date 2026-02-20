import os
import io
import base64
import requests as http_requests
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client, Client

load_dotenv(Path(__file__).parent / '.env')

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_API_KEY)


def pdf_to_base64_images(pdf_url, max_pages=5):
    """Downloads a PDF and converts pages to base64 data URLs for GPT-4o vision."""
    try:
        from pdf2image import convert_from_bytes

        response = http_requests.get(pdf_url, timeout=30)
        response.raise_for_status()

        images = convert_from_bytes(
            response.content,
            first_page=1,
            last_page=max_pages,
            dpi=150
        )

        data_urls = []
        for img in images:
            buffer = io.BytesIO()
            img.save(buffer, format='JPEG', quality=85)
            b64 = base64.b64encode(buffer.getvalue()).decode()
            data_urls.append(f"data:image/jpeg;base64,{b64}")

        print(f"📄 PDF converted: {len(data_urls)} pages")
        return data_urls

    except ImportError:
        print("⚠️ pdf2image not installed. Install with: pip install pdf2image")
        print("⚠️ Also requires poppler: brew install poppler")
        return []
    except Exception as e:
        print(f"❌ PDF conversion error: {e}")
        return []


def analyze_product_file(file_url, file_type, product_file_id):
    """
    Analyzes a single product file (image or PDF) with GPT-4o vision.
    Stores per-file analysis in product_files.ai_analysis.
    """
    try:
        print(f"🔍 Analyzing file: {product_file_id} ({file_type})")

        # Prepare image URLs for vision API
        if file_type == 'application/pdf':
            image_urls = pdf_to_base64_images(file_url, max_pages=5)
            if not image_urls:
                supabase.table("product_files").update({
                    "ai_analysis": "Errore: impossibile convertire il PDF in immagini."
                }).eq("id", product_file_id).execute()
                return None
        else:
            # Direct image URL
            image_urls = [file_url]

        # Build GPT-4o vision message
        content = [
            {
                "type": "text",
                "text": (
                    "Analizza questa immagine di un prodotto o catalogo aziendale. "
                    "Descrivi in dettaglio:\n"
                    "1. Che tipo di prodotto/servizio viene mostrato\n"
                    "2. Materiali, finiture, qualità visibili\n"
                    "3. A quale tipo di cliente/industria è destinato\n"
                    "4. Punti di forza evidenti dal materiale visivo\n\n"
                    "Rispondi in italiano, in modo conciso (max 200 parole)."
                )
            }
        ]

        for img_url in image_urls:
            content.append({
                "type": "image_url",
                "image_url": {"url": img_url, "detail": "high"}
            })

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": content}],
            max_tokens=500
        )

        analysis = response.choices[0].message.content
        print(f"✅ File analyzed: {product_file_id}")

        # Store per-file analysis
        supabase.table("product_files").update({
            "ai_analysis": analysis
        }).eq("id", product_file_id).execute()

        return analysis

    except Exception as e:
        error_msg = f"Errore nell'analisi: {str(e)}"
        print(f"❌ Analysis error for {product_file_id}: {e}")
        supabase.table("product_files").update({
            "ai_analysis": error_msg
        }).eq("id", product_file_id).execute()
        return None


def synthesize_product_description(product_id):
    """
    Combines all per-file AI analyses into a single ai_description for the product.
    Uses GPT-4o-mini (text-only, cheaper) for synthesis.
    """
    try:
        print(f"🧠 Synthesizing description for product: {product_id}")

        # Fetch all analyzed files for this product
        files_res = supabase.table("product_files") \
            .select("ai_analysis, file_name") \
            .eq("product_id", product_id) \
            .order("sort_order") \
            .execute()

        if not files_res.data:
            print("⚠️ No files found for product")
            return None

        analyses = [
            f"[{f['file_name']}]: {f['ai_analysis']}"
            for f in files_res.data
            if f.get('ai_analysis') and not f['ai_analysis'].startswith('Errore')
        ]

        if not analyses:
            print("⚠️ No successful analyses found")
            return None

        combined = "\n\n".join(analyses)

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": (
                    "Basandoti sulle seguenti analisi AI di immagini/cataloghi di prodotto, "
                    "genera UNA descrizione unificata del prodotto (max 300 parole, in italiano).\n\n"
                    "La descrizione deve essere utile per un sistema di lead scoring B2B:\n"
                    "- Cosa offre l'azienda\n"
                    "- Per quali settori/clienti è adatto\n"
                    "- Punti di forza e caratteristiche distintive\n\n"
                    f"ANALISI DEI FILE:\n{combined}\n\n"
                    "DESCRIZIONE UNIFICATA:"
                )
            }],
            max_tokens=600
        )

        ai_description = response.choices[0].message.content
        print(f"✅ Synthesized description for product: {product_id}")

        # Store on product
        supabase.table("products").update({
            "ai_description": ai_description
        }).eq("id", product_id).execute()

        return ai_description

    except Exception as e:
        print(f"❌ Synthesis error: {e}")
        return None
