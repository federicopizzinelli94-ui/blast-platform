from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import sys
import os
import uuid
import time
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# Add current directory to path so we can import tools
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from search_leads import search_leads, search_jobs, search_jobs_lock
from analyze_product import analyze_product_file, synthesize_product_description
from generate_email import generate_email_for_lead

app = FastAPI()

# Configure CORS to allow requests from React (http://localhost:5173)
origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://192.168.1.170:5173",
]
frontend_url = os.environ.get("FRONTEND_URL")
if frontend_url:
    origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SearchRequest(BaseModel):
    product_id: str
    location: str = "Italia"
    limit: int = 10
    min_score: int = 50
    include_province: bool = False

class AnalyzeFileRequest(BaseModel):
    file_url: str
    file_type: str
    product_file_id: str

class SynthesizeRequest(BaseModel):
    product_id: str

class GenerateEmailRequest(BaseModel):
    lead_id: str

@app.get("/")
def read_root():
    return {"status": "Belt-LS API is running"}

@app.post("/search")
def run_search(request: SearchRequest, background_tasks: BackgroundTasks):
    try:
        # Block duplicate concurrent searches for same product
        with search_jobs_lock:
            for jid, job in search_jobs.items():
                if (job.get("status") == "running" and
                    job.get("product_id") == request.product_id):
                    print(f"⚠️ API: Search already running for product {request.product_id} (job {jid})")
                    return {
                        "status": "already_running",
                        "job_id": jid,
                        "message": "Una ricerca per questo prodotto è già in corso"
                    }

        job_id = str(uuid.uuid4())
        print(f"🚀 API: Starting search job {job_id} for product {request.product_id}")
        print(f"   📍 Location: {request.location}, Limit: {request.limit}, Min Score: {request.min_score}")

        # Run search in background with job tracking
        background_tasks.add_task(
            search_leads,
            request.product_id,
            request.location,
            request.limit,
            request.min_score,
            job_id,
            request.include_province
        )

        return {
            "status": "started",
            "job_id": job_id,
            "message": f"Ricerca avviata — solo lead con score ≥ {request.min_score} verranno salvati"
        }
    except Exception as e:
        print(f"❌ API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


JOB_MAX_AGE_SECONDS = 1800  # 30 minutes

def _cleanup_old_jobs():
    """Remove completed/error jobs older than 30 minutes from memory."""
    now = time.time()
    to_delete = []
    with search_jobs_lock:
        for jid, job in search_jobs.items():
            if job.get("status") in ("completed", "error"):
                completed_at = job.get("completed_at", job.get("created_at", 0))
                if now - completed_at > JOB_MAX_AGE_SECONDS:
                    to_delete.append(jid)
        for jid in to_delete:
            del search_jobs[jid]
    if to_delete:
        print(f"🧹 Cleaned up {len(to_delete)} old jobs")

@app.get("/search-status/{job_id}")
def get_search_status(job_id: str):
    """Poll the status of a background search job."""
    _cleanup_old_jobs()

    with search_jobs_lock:
        job = search_jobs.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job non trovato")

    return job

@app.post("/stop-search/{job_id}")
def stop_search(job_id: str):
    """Request graceful stop of a running search job."""
    with search_jobs_lock:
        job = search_jobs.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job non trovato")

    if job.get("status") != "running":
        return {"status": "already_finished", "message": "La ricerca è già terminata"}

    with search_jobs_lock:
        search_jobs[job_id]["stop_requested"] = True

    print(f"🛑 API: Stop requested for job {job_id}")
    return {"status": "stop_requested", "message": "Arresto ricerca in corso..."}


@app.post("/analyze-file")
def run_analyze_file(request: AnalyzeFileRequest, background_tasks: BackgroundTasks):
    try:
        print(f"🔍 API Trigger: Analyzing file {request.product_file_id}")
        background_tasks.add_task(
            analyze_product_file,
            request.file_url,
            request.file_type,
            request.product_file_id
        )
        return {"status": "analyzing", "message": "Analisi file avviata in background"}
    except Exception as e:
        print(f"❌ API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/synthesize-description")
async def run_synthesize(request: SynthesizeRequest):
    try:
        print(f"🧠 API Trigger: Synthesizing description for {request.product_id}")
        result = synthesize_product_description(request.product_id)
        if result:
            return {"status": "completed", "ai_description": result}
        else:
            return {"status": "no_data", "message": "Nessuna analisi file disponibile"}
    except Exception as e:
        print(f"❌ API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-email")
async def run_generate_email(request: GenerateEmailRequest):
    try:
        print(f"📧 API Trigger: Generating email for lead {request.lead_id}")
        result = generate_email_for_lead(request.lead_id)
        if result and "error" not in result:
            return {"status": "completed", "email": result}
        elif result and "error" in result:
            return {"status": "error", "message": result["error"]}
        else:
            return {"status": "error", "message": "Generazione email fallita"}
    except Exception as e:
        print(f"❌ API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ─── User Management (Admin) ───────────────────────────────────────

class CreateUserRequest(BaseModel):
    email: str
    password: str

class DeleteUserRequest(BaseModel):
    user_id: str

def _get_admin_client():
    """Create a Supabase client with service_role key for admin operations."""
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        raise HTTPException(status_code=500, detail="Supabase service role key non configurata")
    return create_client(url, service_key)

@app.post("/create-user")
async def create_user(request: CreateUserRequest):
    try:
        admin = _get_admin_client()
        response = admin.auth.admin.create_user({
            "email": request.email,
            "password": request.password,
            "email_confirm": True
        })
        print(f"✅ User created: {request.email}")
        return {"status": "created", "user_id": response.user.id, "email": response.user.email}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error creating user: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/list-users")
async def list_users():
    try:
        admin = _get_admin_client()
        response = admin.auth.admin.list_users()
        users = [{"id": u.id, "email": u.email, "created_at": str(u.created_at)} for u in response]
        return {"users": users}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error listing users: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/delete-user")
async def delete_user(request: DeleteUserRequest):
    try:
        admin = _get_admin_client()
        admin.auth.admin.delete_user(request.user_id)
        print(f"🗑️ User deleted: {request.user_id}")
        return {"status": "deleted", "user_id": request.user_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error deleting user: {e}")
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
