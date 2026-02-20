import os
from supabase import create_client

# Use the ANON key from dashboard/.env to simulate frontend
SUPABASE_URL = "https://iuuuafkwpblqmznrener.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1dXVhZmt3cGJscW16bnJlbmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NzcyMTksImV4cCI6MjA4NjU1MzIxOX0.S7Mu9ds6AvnV5BnxPcEWELYix_WxZbSa0VkPNy078bo"

client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 1. Create a dummy lead
res = client.table("leads").insert({"company_name": "TO_DELETE"}).execute()
lead_id = res.data[0]['id']
print(f"Created dummy lead: {lead_id}")

# 2. Try to delete it
print("Attempting delete...")
try:
    del_res = client.table("leads").delete().eq("id", lead_id).execute()
    print(f"Delete result: {del_res}")
    if del_res.data:
        print("✅ SUCCESS: Deleted.")
    else:
        print("❌ FAILURE: No data returned (RLS blocked?)")
except Exception as e:
    print(f"❌ ERROR: {e}")
