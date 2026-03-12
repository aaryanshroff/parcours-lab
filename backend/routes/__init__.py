from flask import Blueprint

from routes.health import health_bp
from routes.profile import profile_bp
from routes.chat import chat_bp
from routes.courses import courses_bp

api = Blueprint("api", __name__, url_prefix="/api")
api.register_blueprint(health_bp)
api.register_blueprint(profile_bp)
api.register_blueprint(chat_bp)
api.register_blueprint(courses_bp)