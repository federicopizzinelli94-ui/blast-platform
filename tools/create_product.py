import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(Path(__file__).parent / '.env')

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def create_product(name, description, keywords):
    """
    Creates a new product in the database.
    """
    data = {
        "name": name,
        "description": description,
        "target_keywords": keywords
    }
    
    try:
        response = supabase.table("products").insert(data).execute()
        print(f"✅ Product Created: {name}")
        return response.data[0]['id']
    except Exception as e:
        print(f"❌ Error creating product: {e}")
        return None

if __name__ == "__main__":
    # Interactive mode or arguments
    if len(sys.argv) > 1:
        name = sys.argv[1]
        desc = sys.argv[2]
        keys = sys.argv[3]
        create_product(name, desc, keys)
    else:
        # Default Test Product
        create_product(
            "Etichette Premium", 
            "Etichette in metallo e nobilitazioni per bottiglie di lusso, resistenti e di impatto visivo.", 
            "Cantine vinicole, Produzione Olio, Distillerie"
        )
