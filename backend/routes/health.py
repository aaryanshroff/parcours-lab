from flask import Blueprint

#from config.db import supabase
#temp to test chat

health_bp = Blueprint("health", __name__)


@health_bp.route("/health")
def health():
    try:
        supabase.rpc("health_check").execute()
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"

    status = "ok" if db_status == "ok" else "degraded"
    return {"status": status, "db": db_status}
