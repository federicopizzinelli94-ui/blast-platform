import os
import json
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client, Client

load_dotenv(Path(__file__).parent / '.env')

# Config
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_API_KEY)

def generate_pitch(lead_id):
    """
    Generates a personalized email for a specific lead_id.
    Uses the linked 'interested_product_id' to tailor the pitch.
    """
    # 1. Fetch Lead
    response = supabase.table("leads").select("*, products(*)").eq("id", lead_id).execute()
    if not response.data:
        print(f"❌ Lead {lead_id} not found.")
        return None
        
    lead = response.data[0]
    company_name = lead.get("company_name")
    vertical = lead.get("industry_vertical", "Generico")
    location = lead.get("location", "")
    contact_person = lead.get("contact_person") or "Responsabile Acquisti"
    
    # Check linked product
    product = lead.get("products") # Joined via foreign key if setup
    # If Supabase Join syntax varies, we might need a separate fetch if relation not auto-embedded.
    # Standard format: select('*, products(*)') works if FK exists.
    
    product_name = "Servizi Taglio Laser"
    product_desc = "Taglio laser di precisione per ogni esigenza."
    
    if product:
        product_name = product.get("name")
        product_desc = product.get("description")
        ai_desc = product.get("ai_description")
        if ai_desc:
            product_desc = f"{product_desc}\n\nDettagli AI (da analisi visiva): {ai_desc}"
    elif lead.get("interested_product_id"):
        # Fallback manual fetch if join failed
        p_res = supabase.table("products").select("*").eq("id", lead.get("interested_product_id")).execute()
        if p_res.data:
            product_name = p_res.data[0]['name']
            product_desc = p_res.data[0]['description']
            ai_desc = p_res.data[0].get('ai_description')
            if ai_desc:
                product_desc = f"{product_desc}\n\nDettagli AI (da analisi visiva): {ai_desc}"
    
    print(f"🧠 Generating pitch for: {company_name} -> Selling: {product_name}...")
        
    # 3. Construct Prompt
    prompt = f"""
    Scrivi una email commerciale B2B fredda (Cold Email) in Italiano.
    
    DESTINATARIO:
    Azienda: {company_name}
    Settore: {vertical}
    Luogo: {location}
    Contatto: {contact_person} (se generico, usa un saluto appropriato)
    
    MITTENTE (NOI):
    Azienda: Taglio Laser Pro
    Prodotto da proporre: {product_name}
    Dettagli Prodotto: {product_desc}
    
    OBIETTIVO:
    Ottenere un appuntamento conoscitivo.
    
    ISTRUZIONI:
    - Sii breve (max 150 parole).
    - Usa un tono professionale ma non robotico.
    - Cita il loro settore ({vertical}) per mostrare che abbiamo fatto ricerche.
    - Spiega come il nostro prodotto ({product_name}) risolve un problema specifico per loro.
    
    FORMATO OUTPUT JSON:
    {{
        "subject": "Oggetto della mail",
        "body": "Testo della mail (usa <br> per a capo)"
    }}
    """
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Sei un esperto copywriter B2B."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        content = completion.choices[0].message.content
        data = json.loads(content)
        
        # 4. Save Draft
        campaign_data = {
            "lead_id": lead_id,
            "generated_content": json.dumps(data, ensure_ascii=False),
            "status": "Draft",
            "target_vertical": vertical
        }
        
        try:
             supabase.table("outreach_campaigns").insert(campaign_data).execute()
             print("✅ Email Draft saved to 'outreach_campaigns'.")
             
             supabase.table("leads").update({"status": "Generated"}).eq("id", lead_id).execute()
             
        except Exception as db_err:
             print(f"⚠️ Could not save to campaign table: {db_err}")
        
        return data

    except Exception as e:
        print(f"❌ Error generating pitch: {e}")
        return None

if __name__ == "__main__":
    # Test
    # Need a lead with a product_id to test properly
    print("Run search_leads first to populate leads with product IDs.")
